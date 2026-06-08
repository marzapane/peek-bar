import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class PeekBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(600, 700);

        const settings = this.getSettings('org.gnome.shell.extensions.peek-bar');

        const page = new Adw.PreferencesPage();
        window.add(page);

        const groupGeneral = new Adw.PreferencesGroup({ title: _('General') });
        page.add(groupGeneral);

        const rowHideTopBar = new Adw.SwitchRow({
            title: _('Hide Top Bar'),
            subtitle: _('Automatically hide the top bar when a window overlaps it'),
        });
        groupGeneral.add(rowHideTopBar);
        settings.bind('intellihide', rowHideTopBar, 'active', Gio.SettingsBindFlags.DEFAULT);

        const rowAlwaysHide = new Adw.SwitchRow({
            title: _('Always Hide'),
            subtitle: _('Hide the top bar at all times — reveal it by moving the cursor to the top edge'),
        });
        groupGeneral.add(rowAlwaysHide);
        settings.bind('always-hide', rowAlwaysHide, 'active', Gio.SettingsBindFlags.DEFAULT);

        const rowBehaviour = new Adw.ComboRow({
            title: _('Overlap Detection'),
            subtitle: _('Which windows to consider when determining overlap'),
            model: new Gtk.StringList({
                strings: [_('All Windows'), _('Focused Window'), _('Maximized Windows')],
            }),
        });
        groupGeneral.add(rowBehaviour);
        rowBehaviour.selected = settings.get_enum('behaviour');
        rowBehaviour.connect('notify::selected', () => {
            settings.set_enum('behaviour', rowBehaviour.selected);
        });

        const rowShowFullscreen = new Adw.SwitchRow({
            title: _('Show in Fullscreen'),
            subtitle: _('Allow revealing the bar while an application is in fullscreen'),
        });
        groupGeneral.add(rowShowFullscreen);
        settings.bind('show-in-fullscreen', rowShowFullscreen, 'active', Gio.SettingsBindFlags.DEFAULT);

        const rowShowIndicator = new Adw.SwitchRow({
            title: _('Show Quick Settings Toggle'),
            subtitle: _('Show the Peek Bar toggle in the Quick Settings panel'),
        });
        groupGeneral.add(rowShowIndicator);
        settings.bind('show-indicator', rowShowIndicator, 'active', Gio.SettingsBindFlags.DEFAULT);

        rowHideTopBar.bind_property('active', rowAlwaysHide, 'sensitive', 0);
        rowHideTopBar.bind_property('active', rowShowFullscreen, 'sensitive', 0);

        // Overlap Detection is irrelevant in always-hide mode (the result is ignored).
        const updateOverlapSensitivity = () => {
            rowBehaviour.sensitive = rowHideTopBar.active && !rowAlwaysHide.active;
        };
        rowHideTopBar.connect('notify::active', updateOverlapSensitivity);
        rowAlwaysHide.connect('notify::active', updateOverlapSensitivity);
        updateOverlapSensitivity();

        const groupInteraction = new Adw.PreferencesGroup({ title: _('Interaction') });
        page.add(groupInteraction);

        const rowUsePointer = new Adw.SwitchRow({
            title: _('Reveal with Mouse Pointer'),
            subtitle: _('Moving the pointer to the top edge reveals the bar'),
        });
        groupInteraction.add(rowUsePointer);
        settings.bind('use-pointer', rowUsePointer, 'active', Gio.SettingsBindFlags.DEFAULT);

        const rowRevealedHover = new Adw.SwitchRow({
            title: _('Stay Revealed on Hover'),
            subtitle: _('Keep the bar visible while the mouse pointer is over it'),
        });
        groupInteraction.add(rowRevealedHover);
        settings.bind('revealed-hover', rowRevealedHover, 'active', Gio.SettingsBindFlags.DEFAULT);

        const rowUsePressure = new Adw.SwitchRow({
            title: _('Require Edge Pressure'),
            subtitle: _('Pressure must be applied to the screen edge to reveal the bar'),
        });
        groupInteraction.add(rowUsePressure);
        settings.bind('use-pressure', rowUsePressure, 'active', Gio.SettingsBindFlags.DEFAULT);

        const rowPressureThreshold = new Adw.SpinRow({
            title: _('Pressure Threshold'),
            adjustment: new Gtk.Adjustment({ lower: 1, upper: 10000, step_increment: 10 }),
        });
        groupInteraction.add(rowPressureThreshold);
        settings.bind('pressure-threshold', rowPressureThreshold, 'value', Gio.SettingsBindFlags.DEFAULT);

        const rowPressureTime = new Adw.SpinRow({
            title: _('Pressure Time (ms)'),
            adjustment: new Gtk.Adjustment({ lower: 100, upper: 30000, step_increment: 50 }),
        });
        groupInteraction.add(rowPressureTime);
        settings.bind('pressure-time', rowPressureTime, 'value', Gio.SettingsBindFlags.DEFAULT);

        const groupShortcut = new Adw.PreferencesGroup({ title: _('Keyboard Shortcut') });
        page.add(groupShortcut);

        const shortcutRow = new Adw.ActionRow({
            title: _('Toggle Shortcut'),
            subtitle: _('Click to set a custom keyboard shortcut'),
        });

        const shortcutLabel = new Gtk.ShortcutLabel({
            disabled_text: _('Disabled'),
            accelerator: settings.get_strv('toggle-shortcut')[0] || '',
            valign: Gtk.Align.CENTER,
        });

        shortcutRow.add_suffix(shortcutLabel);
        shortcutRow.activatable_widget = shortcutLabel;

        shortcutRow.connect('activated', () => {
            const dialog = new Adw.Window({
                title: _('Add Custom Shortcut'),
                modal: true,
                transient_for: window,
                default_width: 450,
                default_height: 350,
                hide_on_close: true,
            });

            const box = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 24,
                margin_top: 32,
                margin_bottom: 32,
                margin_start: 32,
                margin_end: 32,
                valign: Gtk.Align.CENTER,
            });

            const title = new Gtk.Label({
                label: '<b>' + _('Enter the new shortcut') + '</b>',
                use_markup: true,
            });
            box.append(title);

            const icon = new Gtk.Image({
                icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
                pixel_size: 128,
            });
            box.append(icon);

            const descLabel = new Gtk.Label({
                label: _('Press Esc to cancel or Backspace to disable the keyboard shortcut'),
                wrap: true,
                justify: Gtk.Justification.CENTER,
            });
            box.append(descLabel);

            const controller = new Gtk.EventControllerKey();
            dialog.add_controller(controller);

            controller.connect('key-pressed', (ctrl, keyval, keycode, state) => {
                let mask = state & Gtk.accelerator_get_default_mod_mask();

                let isModifier = false;
                switch (keyval) {
                    case Gdk.KEY_Alt_L: case Gdk.KEY_Alt_R:
                    case Gdk.KEY_Control_L: case Gdk.KEY_Control_R:
                    case Gdk.KEY_Shift_L: case Gdk.KEY_Shift_R:
                    case Gdk.KEY_Super_L: case Gdk.KEY_Super_R:
                    case Gdk.KEY_Meta_L: case Gdk.KEY_Meta_R:
                        isModifier = true;
                        break;
                }
                if (isModifier) return Gdk.EVENT_PROPAGATE;

                if (state === 0) {
                    if (keyval === Gdk.KEY_Escape) {
                        dialog.close();
                        return Gdk.EVENT_STOP;
                    }
                    if (keyval === Gdk.KEY_BackSpace) {
                        settings.set_strv('toggle-shortcut', []);
                        shortcutLabel.accelerator = '';
                        dialog.close();
                        return Gdk.EVENT_STOP;
                    }
                }

                const accelerator = Gtk.accelerator_name(keyval, mask);
                if (accelerator && Gtk.accelerator_valid(keyval, mask)) {
                    settings.set_strv('toggle-shortcut', [accelerator]);
                    shortcutLabel.accelerator = accelerator;
                    dialog.close();
                    return Gdk.EVENT_STOP;
                }

                return Gdk.EVENT_PROPAGATE;
            });

            dialog.set_content(box);
            dialog.present();
        });

        groupShortcut.add(shortcutRow);

        const groupTimings = new Adw.PreferencesGroup({ title: _('Animation & Delays') });
        page.add(groupTimings);

        const rowAnimTime = new Adw.SpinRow({
            title: _('Animation Time (ms)'),
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 5000, step_increment: 50 }),
        });
        groupTimings.add(rowAnimTime);
        settings.bind('animation-time', rowAnimTime, 'value', Gio.SettingsBindFlags.DEFAULT);

        const rowCloseDelay = new Adw.SpinRow({
            title: _('Hide Delay (ms)'),
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 10000, step_increment: 100 }),
        });
        groupTimings.add(rowCloseDelay);
        settings.bind('close-delay', rowCloseDelay, 'value', Gio.SettingsBindFlags.DEFAULT);

        const rowRevealDelay = new Adw.SpinRow({
            title: _('Reveal Delay (ms)'),
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 10000, step_increment: 100 }),
        });
        groupTimings.add(rowRevealDelay);
        settings.bind('reveal-delay', rowRevealDelay, 'value', Gio.SettingsBindFlags.DEFAULT);

        rowUsePressure.bind_property('active', rowPressureThreshold, 'sensitive', 0);
        rowUsePressure.bind_property('active', rowPressureTime, 'sensitive', 0);
    }
}
