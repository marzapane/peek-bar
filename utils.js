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

import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import Meta from 'gi://Meta'

import St from 'gi://St'

import * as Config from 'resource:///org/gnome/shell/misc/config.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js'

export class BasicHandler {
  constructor() {
    this._storage = {}
  }

  add() {
    let args = [].concat('generic', [].slice.call(arguments))
    this.addWithLabel.apply(this, args)
  }

  addWithLabel(label) {
    if (this._storage[label] === undefined) this._storage[label] = []

    for (let i = 1; i < arguments.length; i++) {
      let item = this._storage[label]
      let handlers = this._create(arguments[i])

      for (let j = 0, l = handlers.length; j < l; ++j) item.push(handlers[j])
    }
  }

  removeWithLabel(label) {
    if (!this._storage[label]) return

    for (let i = 0; i < this._storage[label].length; i++)
      this._remove(this._storage[label][i])

    delete this._storage[label]
  }

  destroy() {
    for (let label in this._storage) this.removeWithLabel(label)
  }

  _create() {
    throw new Error('no implementation')
  }

  _remove() {
    throw new Error('no implementation')
  }
}

export class GlobalSignalsHandler extends BasicHandler {
  _create(item) {
    let handlers = []
    item[1] = [].concat(item[1])

    for (let i = 0, l = item[1].length; i < l; ++i) {
      let object = item[0]
      let event = item[1][i]
      let callback = item[2]
      try {
        handlers.push([object, object.connect(event, callback)])
      } catch (e) {
        console.log(e)
      }
    }

    return handlers
  }

  _remove(item) {
    item[0].disconnect(item[1])
  }
}

export class TimeoutsHandler {
  constructor() {
    this._timeouts = {}
  }

  add(item) {
    let [name, delay, handler] = item
    this.remove(name)

    this._timeouts[name] = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      delay,
      () => {
        delete this._timeouts[name]
        handler()
        return GLib.SOURCE_REMOVE
      },
    )
  }

  remove(name) {
    if (this._timeouts[name]) {
      GLib.Source.remove(this._timeouts[name])
      delete this._timeouts[name]
    }
  }

  getId(name) {
    return this._timeouts[name] || 0
  }

  destroy() {
    for (let name in this._timeouts) {
      GLib.Source.remove(this._timeouts[name])
    }
    this._timeouts = {}
  }
}

export const DisplayWrapper = {
  getWorkspaceManager() {
    return global.workspace_manager
  },

  getMonitorManager() {
    return global.backend.get_monitor_manager()
  },
}

export const getCurrentWorkspace = function () {
  return DisplayWrapper.getWorkspaceManager().get_active_workspace()
}

export const getTrackedActorData = (actor) => {
  let trackedIndex = Main.layoutManager._findActor(actor)

  if (trackedIndex >= 0) return Main.layoutManager._trackedActors[trackedIndex]
}

export const setDisplayUnredirect = (() => {
  let unredirectEnabled = true
  return (enable) => {
    let v48 = Config.PACKAGE_VERSION >= '48'

    if (enable && !unredirectEnabled)
      v48
        ? global.compositor.enable_unredirect()
        : Meta.enable_unredirect_for_display(global.display)
    else if (!enable && unredirectEnabled)
      v48
        ? global.compositor.disable_unredirect()
        : Meta.disable_unredirect_for_display(global.display)

    unredirectEnabled = enable
  }
})()

export const animate = function (actor, options) {
  if (options.delay) options.delay = options.delay * 1000

  options.duration = options.time * 1000
  delete options.time

  if (options.transition) {
    options.mode =
      {
        easeInCubic: Clutter.AnimationMode.EASE_IN_CUBIC,
        easeInOutCubic: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
        easeInOutQuad: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
        easeOutQuad: Clutter.AnimationMode.EASE_OUT_QUAD,
      }[options.transition] || Clutter.AnimationMode.LINEAR

    delete options.transition
  }

  let params = [options]

  if ('value' in options && actor instanceof St.Adjustment) {
    params.unshift(options.value)
    delete options.value
  }

  actor.ease.apply(actor, params)
}

export const stopAnimations = function (actor) {
  actor.remove_all_transitions()
}


export const notify = function (
  title,
  body,
  sourceIconName,
  notificationIcon,
  action,
  isTransient,
) {
  let source = MessageTray.getSystemSource()
  let notification = new MessageTray.Notification({
    source,
    title,
    body,
    isTransient: isTransient || false,
    gicon: notificationIcon || null,
  })

  if (sourceIconName) source.iconName = sourceIconName

  if (action) {
    if (!(action instanceof Array)) action = [action]
    action.forEach((a) => notification.addAction(a.text, a.func))
  }

  source.addNotification(notification)
}
