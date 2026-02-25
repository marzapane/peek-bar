

Coming from Windows 11, GNOME was missing one crucial feature so i made it myself

![Untitled video](https://github.com/user-attachments/assets/71d1e594-bbde-46f8-9ae1-168dd3478586)


So 3 months ago i made the jump from windows 11 to linux (omarchy) which literally made me fall in love with linux. it’s just fast, lightweight and customizable and the themes etc wow. eventually i went down the deep hole trying raw arch+hyprland and niri, tried some other distros and also distro-hopping between omarchy and fedora gnome. i finally decided to leave omarchy after reading this article ‘a word on omarchy’.

actually, the reason i loved GNOME is because it's a FULL DE unlike omarchy. plus, gnome is just beautiful, the icons, the design philosophy, and honestly, getting used to mutter (window manager) actually feels better than hyprland (compositor) to ME.

but coming from a setup where i relied on an auto-hiding taskbar, i immediately hit a wall. squeezing a full workflow onto a 14-inch Latitude laptop means every single pixel of vertical space matters, and surprisingly GNOME doesn't have native auto-hide for the top bar, which is disappointing.

i tried the existing extensions out there. 'Hide Top Bar' is the only main one with autohide, but for some reason it shrinks the icon size in the app grid? plus it's not smooth at all and doesn't feel native. there are 2 or 3 others but they have the same icon shrink issue, are buggy, laggy, and don’t even have a proper auto-hide.

luckily i found a perfect, buttery-smooth auto-hide animation hidden inside the popular 'Dash to Panel' extension (made by zorinOS). the catch is, dash to panel completely replaces the GNOME layout with a custom windows-style taskbar and packs in dozens of features when i literally only wanted THAT one feature: auto-hiding my top bar except in overview.

so yeah, based on dash to panel, i made a new minimal extension tweaking it to work for gnome's stock top bar instead of a custom bar. i just extracted that flawless smooth auto-hide and made it work seamlessly with stock GNOME without all the extra bloat.

here is the link if anyone wants to try it out: https://extensions.gnome.org/extension/9394/peek-bar/
