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
import { PopupMenuItem } from 'resource:///org/gnome/shell/ui/popupMenu.js'
import { QuickMenuToggle, SystemIndicator } from 'resource:///org/gnome/shell/ui/quickSettings.js'
import {
  Extension,
  InjectionManager,
} from 'resource:///org/gnome/shell/extensions/extension.js'

import * as Intellihide from './intellihide.js'
import * as Proximity from './proximity.js'
import * as Utils from './utils.js'

const PeekBarIndicator = GObject.registerClass(
  class PeekBarIndicator extends SystemIndicator {
    _init(settings, extension) {
      super._init()
      this._settings = settings

      this.quickToggle = new QuickMenuToggle({
        title: 'Peek Bar',
        iconName: 'focus-top-bar-symbolic',
        toggleMode: true,
      })

      this.quickToggle.menu.setHeader('focus-top-bar-symbolic', 'Peek Bar')

      let prefsItem = new PopupMenuItem('Settings')
      prefsItem.connect('activate', () => {
        Main.panel.closeQuickSettings()
        extension.openPreferences()
      })
      this.quickToggle.menu.addMenuItem(prefsItem)

      this.quickToggle.checked = this._settings.get_boolean('intellihide')

      this._toggleClickedId = this.quickToggle.connect('clicked', () => {
        this._settings.set_boolean('intellihide', this.quickToggle.checked)
      })

      this._settingsChangedId = this._settings.connect('changed::intellihide', () => {
        this.quickToggle.checked = this._settings.get_boolean('intellihide')
      })

      this.connect('destroy', () => {
        if (this._toggleClickedId) {
            this.quickToggle.disconnect(this._toggleClickedId)
            this._toggleClickedId = null
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId)
            this._settingsChangedId = null
        }
      })

      this.quickSettingsItems.push(this.quickToggle)
    }
  })

class StockTopBarController {
  constructor(settings, notificationSettings, extension) {
    this._settings = settings
    this._notificationSettings = notificationSettings
    this._extension = extension
  }

  enable() {
    this._signalsHandler = new Utils.GlobalSignalsHandler()

    this._signalsHandler.add(
      [
        this._settings,
        'changed::intellihide',
        () => this._updateCore(),
      ],
      [
        this._settings,
        [
          'changed::always-hide',
          'changed::use-pointer',
          'changed::use-pressure',
          'changed::behaviour',
          'changed::pressure-threshold',
          'changed::pressure-time',
        ],
        () => this._resetCore(),
      ],
      [
        this._settings,
        'changed::show-indicator',
        () => this._updateIndicator(),
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
    if (this._settings.get_boolean('intellihide')) {
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

    if (!Main.panel || !Main.layoutManager.panelBox || !Main.layoutManager.primaryMonitor) {
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
  }

  _createIntellihide() {
    this.intellihide = new Intellihide.Intellihide(
      this.proximityManager,
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
              if (controller.intellihide && Main.layoutManager.panelBox.translation_y < 0) {
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
    if (this._indicator) return
    if (!this._settings.get_boolean('show-indicator')) return
    this._indicator = new PeekBarIndicator(this._settings, this._extension)
    Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator)
  }

  _updateIndicator() {
    if (this._settings.get_boolean('show-indicator')) {
      this._setupIndicator()
    } else {
      this._destroyIndicator()
    }
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
      this,
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
