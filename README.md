# Calendar-Widget

A small desktop widget that displays Google Calendar events.

## Download & Install

Installers are published as GitHub Release assets. After a release is created (tag `v*`) the Windows
installer will be attached to the release.

Download the latest Windows installer from the Releases page and run the executable to install:

- https://github.com/kidlatpogi/Calendar-Widget/releases

If you prefer to build locally:

```powershell
npm install
npm run predist
npm run dist
```

The packaged installer will be in the `dist/` folder after a successful build.

## Notes
- If you want the app to appear with a custom icon in the installer, place a 256x256 `icon.ico` in
	the `assets/` folder and restore the `icon` entry in the `build.win` section of `package.json`.

## CI Releases
This repository includes a GitHub Actions workflow that builds and uploads the Windows installer when
you push a tag prefixed with `v` (for example `v1.1.2`).
# Calendar-Widget