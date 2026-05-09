/*
 * This file is part of the Peekbar extension for GNOME Shell.
 * Based on code from the Dash-To-Panel extension.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

import Clutter from 'gi://Clutter'
import Meta from 'gi://Meta'
import Mtk from 'gi://Mtk'
import Shell from 'gi://Shell'

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js'
import * as PointerWatcher from 'resource:///org/gnome/shell/ui/pointerWatcher.js'

import * as Proximity from './proximity.js'
import * as Utils from './utils.js'

const CHECK_POINTER_MS = 200
const CHECK_GRAB_MS = 400
const POST_ANIMATE_MS = 50
const MIN_UPDATE_MS = 250

const T1 = 'checkGrabTimeout'
const T2 = 'limitUpdateTimeout'
const T3 = 'postAnimateTimeout'
const T4 = 'enableStartTimeout'

const SIDE_CONTROLS_ANIMATION_TIME =
  OverviewControls.SIDE_CONTROLS_ANIMATION_TIME > 1
    ? OverviewControls.SIDE_CONTROLS_ANIMATION_TIME / 1000
    : OverviewControls.SIDE_CONTROLS_ANIMATION_TIME

export const Hold = {
  NONE: 0,
  TEMPORARY: 1,
  NOTIFY: 4,
}

export class Intellihide {
  constructor(panelAdapter, settings, notificationSettings) {
    this._panelAdapter = panelAdapter
    this._panelBox = panelAdapter.panelBox
    this._panelManager = panelAdapter.panelManager
    this._proximityManager = this._panelManager.proximityManager
    this._settings = settings
    this._notificationSettings = notificationSettings
    this._holdStatus = Hold.NONE

    this._signalsHandler = new Utils.GlobalSignalsHandler()
    this._timeoutsHandler = new Utils.TimeoutsHandler()
    this._monitor = this._panelAdapter.monitor
    this._animationDestination = -1
    this._pendingUpdate = false
    this._overviewTransition = false
    this._hover = false
    this._hoveredOut = false
    this._windowOverlap = false

    this._panelBox.translation_y = 0

    this._setTrackPanel(true)
    this._bindGeneralSignals()

    // Watch only the panel bar area, not the entire screen.
    // We use the panelBox actor itself so the rect tracks the actual bar.
    this._proximityWatchId = this._proximityManager.createWatch(
      this._panelBox,
      this._panelAdapter.monitor.index,
      this._settings.get_enum('behaviour'),
      (overlap) => {
        this._windowOverlap = overlap
        this._queueUpdatePanelPosition()
      },
    )

    if (this._settings.get_boolean('use-pointer'))
      this._setRevealMechanism()

    this._validateSettings()

    this._timeoutsHandler.add([
      T4,
      this._settings.get_int('enable-start-delay'),
      () => this._queueUpdatePanelPosition(),
    ])
  }

  destroy() {
    this._hover = false

    if (this._proximityWatchId) {
      this._proximityManager.removeWatch(this._proximityWatchId)
      this._proximityWatchId = null
    }

    this._setTrackPanel(false)
    this._removeRevealMechanism()

    this._revealPanel(true)

    this._signalsHandler.destroy()
    this._timeoutsHandler.destroy()
  }

  revealAndHold(holdStatus, immediate) {
    if (
      holdStatus == Hold.NOTIFY &&
      (!this._settings.get_boolean('show-on-notification') ||
        !this._notificationSettings.get_boolean('show-banners'))
    )
      return

    if (!this._holdStatus) this._revealPanel(immediate)

    this._holdStatus |= holdStatus
  }

  release(holdStatus) {
    if (this._holdStatus & holdStatus) this._holdStatus -= holdStatus

    if (!this._holdStatus) {
      this._queueUpdatePanelPosition()
    }
  }


  _bindGeneralSignals() {
    let setOverviewTransition = (active) => {
      this._overviewTransition = active
      this._hover = false
      this._hoveredOut = false
      this._queueUpdatePanelPosition()
    }

    this._signalsHandler.add(
      [
        this._panelAdapter.taskbar,
        ['menu-closed', 'end-drag'],
        () => this._queueUpdatePanelPosition(),
      ],
      [
        this._panelAdapter.taskbar.previewMenu,
        'open-state-changed',
        () => this._queueUpdatePanelPosition(),
      ],
      [Main.overview, 'showing', () => setOverviewTransition(true)],
      [Main.overview, 'shown', () => setOverviewTransition(false)],
      [Main.overview, 'hiding', () => setOverviewTransition(true)],
      [Main.overview, 'hidden', () => setOverviewTransition(false)],
    )

    let isWayland = typeof Meta.is_wayland_compositor === 'function' ? Meta.is_wayland_compositor() : true;
    if (isWayland) {
      this._signalsHandler.add([
        this._panelBox,
        'notify::visible',
        () => Utils.setDisplayUnredirect(!this._panelBox.visible),
      ])
    }
  }

  _setTrackPanel(enable) {
    let actorData = Utils.getTrackedActorData(this._panelBox)
    if (!actorData) {
      console.warn('[Peek Bar] Could not find tracked actor data for panel box')
      return
    }

    actorData.affectsStruts = !enable
    actorData.trackFullscreen = !enable

    this._panelBox.visible = enable ? enable : this._panelBox.visible

    Main.layoutManager._queueUpdateRegions()
  }

  _validateSettings() {
    const clamp = (key, min, max) => {
      let val = this._settings.get_int(key)
      if (val < min || val > max) {
        val = Math.max(min, Math.min(max, val))
        this._settings.set_int(key, val)
        console.warn(`[Peek Bar] Setting '${key}' out of range, clamped to ${val}`)
      }
    }

    clamp('animation-time', 0, 5000)
    clamp('close-delay', 0, 10000)
    clamp('reveal-delay', 0, 10000)
    clamp('enable-start-delay', 0, 30000)
    clamp('pressure-threshold', 1, 10000)
    clamp('pressure-time', 100, 30000)
  }

  _setRevealMechanism() {
    let barriers = Meta.BackendCapabilities.BARRIERS

    if (
      (global.backend.capabilities & barriers) === barriers &&
      this._settings.get_boolean('use-pressure')
    ) {
      this._edgeBarrier = this._createBarrier()
      this._pressureBarrier = new Layout.PressureBarrier(
        this._settings.get_int('pressure-threshold'),
        this._settings.get_int('pressure-time'),
        Shell.ActionMode.NORMAL,
      )
      this._pressureBarrier.addBarrier(this._edgeBarrier)
      this._signalsHandler.add([
        this._pressureBarrier,
        'trigger',
        () => {
          this._queueUpdatePanelPosition(true)
        },
      ])
    }

    this._pointerWatch = PointerWatcher.getPointerWatcher().addWatch(
      CHECK_POINTER_MS,
      (x, y) => this._checkMousePointer(x, y),
    )
  }

  _removeRevealMechanism() {
    if (this._pointerWatch) {
      PointerWatcher.getPointerWatcher()._removeWatch(this._pointerWatch)
      this._pointerWatch = null
    }

    if (this._pressureBarrier) {
      this._pressureBarrier.destroy()
      this._edgeBarrier.destroy()

      this._pressureBarrier = null
    }
  }

  _createBarrier() {
    return new Meta.Barrier({
      backend: global.backend,
      x1: this._monitor.x,
      x2: this._monitor.x + this._monitor.width,
      y1: this._monitor.y,
      y2: this._monitor.y,
      directions: Meta.BarrierDirection.POSITIVE_Y,
    })
  }

  _checkMousePointer(x, y) {
    if (
      !this._pressureBarrier &&
      !this._hover &&
      !this._overviewTransition &&
      this._pointerIsAtTopEdge(x, y, 1)
    ) {
      this._hover = true
      this._queueUpdatePanelPosition(true)
    } else if (this._panelBox.visible) {
      let keepRevealedOnHover = this._settings.get_boolean('revealed-hover')
      let fixedOffset = keepRevealedOnHover
        ? this._panelBox.height
        : 1
      let hover = this._pointerIsAtTopEdge(x, y, fixedOffset)

      if (hover == this._hover) return

      this._hoveredOut = !hover
      this._hover = hover
      this._queueUpdatePanelPosition()
    }
  }

  _pointerIsAtTopEdge(x, y, fixedOffset) {
    return (
      y <= this._monitor.y + fixedOffset &&
      x >= this._monitor.x &&
      x < this._monitor.x + this._monitor.width &&
      y >= this._monitor.y &&
      y < this._monitor.y + this._monitor.height
    )
  }

  _queueUpdatePanelPosition(fromRevealMechanism) {
    if (
      !fromRevealMechanism &&
      this._timeoutsHandler.getId(T2) &&
      !this._overviewTransition
    ) {
      this._pendingUpdate = true
    } else if (!this._holdStatus) {
      this._checkIfShouldBeVisible(fromRevealMechanism)
        ? this._revealPanel()
        : this._hidePanel()
      this._timeoutsHandler.add([
        T2,
        MIN_UPDATE_MS,
        () => this._endLimitUpdate(),
      ])
    }
  }

  _endLimitUpdate() {
    if (this._pendingUpdate) {
      this._pendingUpdate = false
      this._queueUpdatePanelPosition()
    }
  }

  _checkIfShouldBeVisible(fromRevealMechanism) {
    if (
      Main.overview.visibleTarget ||
      this._panelAdapter.taskbar.previewMenu.opened ||
      this._panelAdapter.taskbar._dragMonitor ||
      this._hover ||
      Main.layoutManager.panelBox.get_hover() ||
      this._checkIfGrab()
    ) {
      return true
    }

    if (fromRevealMechanism) {
      let mouseBtnIsPressed =
        global.get_pointer()[2] & Clutter.ModifierType.BUTTON1_MASK

      if (this._monitor.inFullscreen && !mouseBtnIsPressed) {
        return this._settings.get_boolean('show-in-fullscreen')
      }

      return !mouseBtnIsPressed
    }

    return !this._windowOverlap
  }

  _checkIfGrab() {
    let grabActor = global.stage.get_grab_actor()
    let sourceActor = grabActor?._sourceActor || grabActor
    let isGrab =
      sourceActor &&
      (sourceActor == Main.layoutManager.dummyCursor ||
        this._panelAdapter.statusArea.quickSettings?.menu.actor.contains(
          sourceActor,
        ) ||
        this._panelAdapter.panel.contains(sourceActor))

    if (!isGrab && Main.panel.menuManager?.activeMenu)
      isGrab = true

    if (isGrab)
      this._timeoutsHandler.add([
        T1,
        CHECK_GRAB_MS,
        () => this._queueUpdatePanelPosition(),
      ])

    return isGrab
  }

  _revealPanel(immediate) {
    if (!this._panelBox.visible) {
      this._panelBox.visible = true
      this._panelAdapter.taskbar._shownInitially = false
    }

    this._animatePanel(
      0,
      immediate,
      () => (this._panelAdapter.taskbar._shownInitially = true),
    )
  }

  _hidePanel(immediate) {
    let size = this._panelBox.height
    this._animatePanel(-size, immediate)
  }

  _animatePanel(destination, immediate, onComplete) {
    if (destination === this._animationDestination) return

    Utils.stopAnimations(this._panelBox)
    this._animationDestination = destination

    let update = () =>
      this._timeoutsHandler.add([
        T3,
        POST_ANIMATE_MS,
        () => {
          Main.layoutManager._queueUpdateRegions()
          this._queueUpdatePanelPosition()
        },
      ])

    if (immediate) {
      this._panelBox.translation_y = destination
      this._panelBox.visible = !destination
      update()
    } else if (destination !== this._panelBox.translation_y) {
      let delay = 0

      if (this._overviewTransition) {
        delay = 0
      } else if (destination != 0 && this._hoveredOut)
        delay = this._settings.get_int('close-delay') * 0.001
      else if (destination == 0)
        delay = this._settings.get_int('reveal-delay') * 0.001

      let tweenOpts = {
        time: this._overviewTransition
          ? SIDE_CONTROLS_ANIMATION_TIME
          : this._settings.get_int('animation-time') * 0.001,
        delay,
        transition: 'easeOutQuad',
        onComplete: () => {
          this._panelBox.visible = !destination
          onComplete ? onComplete() : null
          update()
        },
      }

      tweenOpts.translation_y = destination
      Utils.animate(this._panelBox, tweenOpts)
    }

    this._hoveredOut = false
  }
}
