/*
 * This file is part of the Peekbar extension for GNOME Shell.
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

import Gio from 'gi://Gio'


import Meta from 'gi://Meta'
import Shell from 'gi://Shell'

import GObject from 'gi://GObject'

import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import { QuickToggle, SystemIndicator } from 'resource:///org/gnome/shell/ui/quickSettings.js'
import { EventEmitter } from 'resource:///org/gnome/shell/misc/signals.js'
import {
  Extension,
  InjectionManager,
} from 'resource:///org/gnome/shell/extensions/extension.js'

import * as Intellihide from './intellihide.js'
import * as Proximity from './proximity.js'
import * as Utils from './utils.js'

const PeekBarIndicator = GObject.registerClass(
  class PeekBarIndicator extends SystemIndicator {
    _init(settings) {
      super._init()
      this._settings = settings

      this.quickToggle = new QuickToggle({
        title: 'Peek Bar',
        iconName: 'view-reveal-symbolic',
        toggleMode: true,
      })

      this.quickToggle.checked = this._settings.get_boolean('intellihide')

      this.quickToggle.connect('clicked', () => {
        this._settings.set_boolean('intellihide', this.quickToggle.checked)
      })

      this._settings.connect('changed::intellihide', () => {
        this.quickToggle.checked = this._settings.get_boolean('intellihide')
      })

      this.quickSettingsItems.push(this.quickToggle)
    }
  })

class StockTopBarController {
  constructor(settings, notificationSettings) {
    this._settings = settings
    this._notificationSettings = notificationSettings
  }

  enable() {
    this._signalsHandler = new Utils.GlobalSignalsHandler()

    this._signalsHandler.add(
      [
        this._settings,
        'changed::intellihide',
        () => {
          this._updateCore();
        },
      ],
      [
        this._settings,
        [
          'changed::use-pointer',
          'changed::use-pressure',
          'changed::hide-from-windows',
          'changed::hide-from-monitor-windows',
          'changed::behaviour',
          'changed::pressure-threshold',
          'changed::pressure-time',
        ],
        () => {
          this._resetCore();
        },
      ],
    )

    this._bindShortcut()
    this._setupIndicator()

    this._updateCore()
  }

  disable() {
    this._unbindShortcut()
    this._destroyIndicator()

    this._disableCore()

    this._signalsHandler?.destroy()
    this._signalsHandler = null
  }

  _updateCore() {
    let isEnabled = this._settings.get_boolean('intellihide');
    if (isEnabled) {
      if (!this._coreEnabled) this._enableCore()
    } else {
      this._disableCore()
    }
  }

  _enableCore() {
    if (this._coreEnabled) return
    this._coreEnabled = true

    this.proximityManager = new Proximity.ProximityManager()
    this._coreSignalsHandler = new Utils.GlobalSignalsHandler()
    this._injectionManager = new InjectionManager()
    this._panelAdapter = this._createPanelAdapter()

    if (!this._panelAdapter) {
      this._coreEnabled = false;
      return
    }

    this._patchOverviewAllocation()
    this._patchShortcuts()

    this._coreSignalsHandler.add(
      [
        Utils.DisplayWrapper.getMonitorManager(),
        'monitors-changed',
        () => {
          if (!Main.layoutManager.primaryMonitor) return

          this._panelAdapter.monitor = Main.layoutManager.primaryMonitor
          this._resetCore()
        },
      ]
    )

    this._createIntellihide()
  }

  _disableCore() {
    if (!this._coreEnabled) return
    this._coreEnabled = false

    this._destroyIntellihide()

    this._injectionManager?.clear()
    this._injectionManager = null

    this._coreSignalsHandler?.destroy()
    this._coreSignalsHandler = null

    this.proximityManager?.destroy()
    this.proximityManager = null
    this._panelAdapter = null
  }

  _createIntellihide() {
    this.intellihide = new Intellihide.Intellihide(
      this._panelAdapter,
      this._settings,
      this._notificationSettings,
    );
  }

  _destroyIntellihide() {
    this.intellihide?.destroy()
    this.intellihide = null
  }

  _resetCore() {
    if (this._coreEnabled) {
      this._disableCore()
      this._enableCore()
    }
  }



  _patchOverviewAllocation() {
    let overviewControls = Main.overview?._overview?._controls
    if (!overviewControls) return

    this._injectionManager.overrideMethod(
      Object.getPrototypeOf(overviewControls),
      'vfunc_allocate',
      (originalAllocate) =>
        function (box) {
          if (Main.overview.visibleTarget || Main.overview.visible) {
            let panelBox = Main.layoutManager.panelBox
            if (!panelBox) {
              originalAllocate.call(this, box)
              return
            }
            let translationY = panelBox.translation_y || 0
            let visibleHeight =
              panelBox.visible && panelBox.height
                ? Math.max(0, panelBox.height + translationY)
                : 0

            if (visibleHeight > 0) box.y1 += visibleHeight
          }

          originalAllocate.call(this, box)
        },
    )
  }

  _patchShortcuts() {
    let panelPrototype = Object.getPrototypeOf(Main.panel)
    if (!panelPrototype) return

    ['toggleQuickSettings', 'toggleCalendar'].forEach(method => {
      if (typeof panelPrototype[method] === 'function') {
        this._injectionManager.overrideMethod(
          panelPrototype,
          method,
          (original) => {
            let controller = this;
            return function () {
              if (controller.intellihide && !Main.layoutManager.panelBox.visible) {
                controller.intellihide._revealPanel(true)
              }
              original.call(this)
            }
          }
        )
      }
    })
  }

  _setupIndicator() {
    this._indicator = new PeekBarIndicator(this._settings)
    Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator)
  }

  _destroyIndicator() {
    if (this._indicator) {
      this._indicator.quickToggle.destroy()
      this._indicator.destroy()
      this._indicator = null
    }
  }

  _bindShortcut() {
    Main.wm.addKeybinding(
      'toggle-shortcut',
      this._settings,
      Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
      Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
      () => {
        let current = this._settings.get_boolean('intellihide')
        this._settings.set_boolean('intellihide', !current)
      }
    )
  }

  _unbindShortcut() {
    Main.wm.removeKeybinding('toggle-shortcut')
  }

  _createPanelAdapter() {
    let panel = Main.panel
    let panelBox = Main.layoutManager.panelBox
    let monitor = Main.layoutManager.primaryMonitor

    if (!panel || !panelBox || !monitor) return null

    let taskbar = new EventEmitter()
    taskbar.previewMenu = new EventEmitter()
    taskbar.previewMenu.opened = false
    taskbar._dragMonitor = 0
    taskbar._shownInitially = true

    return {
      panelManager: this,
      panel,
      statusArea: panel.statusArea,
      panelBox,
      monitor,
      taskbar,
      isPrimary: true,
      get geom() {
        return {
          position: St.Side.TOP,
          outerSize: panelBox.height,
        }
      },
    }
  }
}

export default class TopBarIntellihideExtension extends Extension {
  enable() {
    this._settings = this.getSettings(
      'org.gnome.shell.extensions.peek-bar',
    )
    this._notificationSettings = new Gio.Settings({
      schema_id: 'org.gnome.desktop.notifications',
    })

    this._controller = new StockTopBarController(
      this._settings,
      this._notificationSettings,
    )
    this._controller.enable()
  }

  disable() {

    this._controller?.disable()
    this._controller = null

    this._settings = null
    this._notificationSettings = null
  }

}
