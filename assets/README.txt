Place your Windows icon file here as `icon.ico` (256x256 preferred). The build config references `assets/icon.ico` for the installer icon.

If you don't have an icon, you can create one from a PNG using tools like:
- https://icoconvert.com/
- ImageMagick + ico plugin

Once you add `icon.ico`, run:

npm install
npm run dist

The installer artifacts will be written to the `dist/` folder.