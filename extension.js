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

import St from 'gi://St'

import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import { EventEmitter } from 'resource:///org/gnome/shell/misc/signals.js'
import {
  Extension,
  InjectionManager,
  gettext as _,
} from 'resource:///org/gnome/shell/extensions/extension.js'

import * as Intellihide from './intellihide.js'
import * as Proximity from './proximity.js'
import * as Utils from './utils.js'

class StockTopBarController {
  constructor(settings, notificationSettings) {
    this._settings = settings
    this._notificationSettings = notificationSettings
  }

  enable() {
    this.proximityManager = new Proximity.ProximityManager()
    this._signalsHandler = new Utils.GlobalSignalsHandler()
    this._injectionManager = new InjectionManager()
    this._panelAdapter = this._createPanelAdapter()

    if (!this._panelAdapter) return

    this._patchOverviewAllocation()

    this.intellihide = new Intellihide.Intellihide(
      this._panelAdapter,
      this._settings,
      this._notificationSettings,
    )
    this.intellihide.init()

    this._signalsHandler.add([
      Utils.DisplayWrapper.getMonitorManager(),
      'monitors-changed',
      () => {
        if (!Main.layoutManager.primaryMonitor) return

        this._panelAdapter.monitor = Main.layoutManager.primaryMonitor
        this.intellihide?.reset()
      },
    ])
  }

  disable() {
    this._injectionManager?.clear()
    this._injectionManager = null

    this.intellihide?.destroy()
    this.intellihide = null

    this._signalsHandler?.destroy()
    this._signalsHandler = null

    this.proximityManager?.destroy()
    this.proximityManager = null
    this._panelAdapter = null
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

  openPreferences() {
    Utils.notify(
      _('No Preferences'),
      _('This extension has no configurable preferences.'),
      'dialog-information-symbolic',
      null,
      null,
      true,
    )
  }

}
