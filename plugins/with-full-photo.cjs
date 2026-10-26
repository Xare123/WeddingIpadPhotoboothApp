/**
 * Opt-in preservation for official expo-camera 58.0.12 (MIT, Expo/650 Industries).
 * See full-photo.md for provenance, limitations, and native release gates.
 * Refuses all native source drift. No changes to the default capture path.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const VERSION = '58.0.12';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Full-photo patch anchor must occur exactly once');
  return source.replace(before, after);
}
const specs = [
  {
    file: 'ios/Common/PictureOptions.swift',
    original: '318736c97915d28290aaec001c818f1ffa2ab0150aef499a9177501f0ab435e3',
    transform: source => replaceOnce(source, '  var pictureRef: Bool = false\n', '  var pictureRef: Bool = false\n\n  // Wedding booth: opt-in camera-file preservation, not a processed derivative.\n  @Field\n  var preserveFullPhoto: Bool = false\n'),
  },
  {
    file: 'ios/CameraViewModule.swift',
    original: '383e39a5262a31624039055fbd074e3ce5579883cb26eec12c5d2bccfe60f742',
    transform: source => replaceOnce(source, '    Name("ExpoCamera")\n', '    Name("ExpoCamera")\n\n    Constant("preserveFullPhotoAvailable") { true }\n'),
  },
  {
    file: 'ios/Current/CameraPhotoCapture.swift',
    original: '032170efecad59a2902659d9cfa7959cf77f45c24c39f9c9272eadaf0f81a394',
    transform(source) {
      source = replaceOnce(source, 'import AVFoundation\n', 'import AVFoundation\nimport ImageIO\nimport UniformTypeIdentifiers\n');
      source = replaceOnce(source, '    guard photoCapturedContinuation == nil else {', `    if options.preserveFullPhoto && options.pictureRef {
      throw CameraSavingImageException("Full-photo preservation does not support pictureRef")
    }
    if options.preserveFullPhoto && !photoOutput.availablePhotoCodecTypes.contains(.jpeg) {
      throw CameraSavingImageException("Full-photo preservation requires JPEG capture support")
    }
    guard photoCapturedContinuation == nil else {`);
      source = replaceOnce(source, '      if photoOutput.availablePhotoCodecTypes.contains(AVVideoCodecType.hevc) {', `      if options.preserveFullPhoto {
        photoSettings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
      } else if photoOutput.availablePhotoCodecTypes.contains(AVVideoCodecType.hevc) {`);
      source = replaceOnce(source, '    guard let imageData, var takenImage = UIImage(data: imageData) else {', `    if options.preserveFullPhoto {
      guard let imageData,
        let source = CGImageSourceCreateWithData(imageData as CFData, nil),
        let sourceType = CGImageSourceGetType(source),
        (sourceType as String) == UTType.jpeg.identifier,
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
        let width = properties[kCGImagePropertyPixelWidth as String] as? NSNumber,
        let height = properties[kCGImagePropertyPixelHeight as String] as? NSNumber else {
        throw CameraSavingImageException("Full-photo JPEG metadata unavailable")
      }
      let path = FileSystemUtilities.generatePathInCache(
        captureDelegate.appContext,
        in: "Camera",
        extension: ".jpg"
      )
      guard let uri = ExpoCameraUtils.write(data: imageData, to: path) else {
        throw CameraSavingImageException("Failed to preserve full-photo JPEG")
      }
      // Deliberately write fileDataRepresentation bytes unchanged. Orientation stays in EXIF.
      var response: [String: Any] = [
        "uri": uri, "width": width.doubleValue, "height": height.doubleValue,
        "format": "jpg", "originalPreserved": true
      ]
      if options.exif {
        var exif = metadata[kCGImagePropertyExifDictionary as String] as? [String: Any] ?? [:]
        exif["Orientation"] = properties[kCGImagePropertyOrientation as String]
        exif["PixelXDimension"] = width
        exif["PixelYDimension"] = height
        response["exif"] = exif
      }
      if options.base64 {
        response["base64"] = imageData.base64EncodedString()
      }
      if options.fastMode {
        captureDelegate.onPictureSaved(["data": response, "id": options.id])
        return ()
      }
      return response
    }

    guard let imageData, var takenImage = UIImage(data: imageData) else {`);
      return source;
    },
  },
];
// Literal post-transform hashes are part of the reviewed contract, not learned at runtime.
const transformedHashes = {
  'ios/Common/PictureOptions.swift': 'cf239f0a2af426ee51d6083b6240af93c2f951c2f45ea05a7b89df4c22ba0ea2',
  'ios/CameraViewModule.swift': '00da150de123628762d72c126a3a5b75903f8c7919d20609adf361f52bbbd43d',
  'ios/Current/CameraPhotoCapture.swift': '62b305bc0a82f301823f1f8c20bdc546b4fecd0cc7733f5cdcf31a83fd79ef89',
};
function preparePatch(cameraRoot) {
  const version = JSON.parse(fs.readFileSync(path.join(cameraRoot, 'package.json'), 'utf8')).version;
  if (version !== VERSION) throw new Error(`Full-photo patch requires expo-camera ${VERSION}; found ${version}`);
  return specs.map(spec => {
    const filename = path.join(cameraRoot, spec.file);
    const source = fs.readFileSync(filename, 'utf8');
    const hash = digest(source);
    if (hash === transformedHashes[spec.file]) return { filename, source, changed: false };
    if (hash !== spec.original) throw new Error(`Full-photo native source drift: ${spec.file}`);
    const transformed = spec.transform(source);
    if (digest(transformed) !== transformedHashes[spec.file]) throw new Error(`Full-photo transform hash mismatch: ${spec.file}`);
    return { filename, source: transformed, changed: true };
  });
}
function applyPatch(cameraRoot) {
  // Validate every input and output before the first write; partial/unknown trees never proceed.
  const prepared = preparePatch(cameraRoot);
  for (const entry of prepared) if (entry.changed) fs.writeFileSync(entry.filename, entry.source);
  return prepared.filter(entry => entry.changed).length;
}
function withFullPhoto(config) {
  const { withDangerousMod } = require('expo/config-plugins');
  return withDangerousMod(config, ['ios', async mod => {
    const manifest = require.resolve('expo-camera/package.json', { paths: [mod.modRequest.projectRoot] });
    applyPatch(path.dirname(manifest));
    return mod;
  }]);
}
module.exports = withFullPhoto;
module.exports.applyPatch = applyPatch;
module.exports.preparePatch = preparePatch;
module.exports.specs = specs;
module.exports.digest = digest;
module.exports.transformedHashes = transformedHashes;
if (require.main === module) {
  const cameraRoot = path.dirname(require.resolve('expo-camera/package.json', { paths: [process.cwd()] }));
  console.log(`Full-photo native files updated: ${applyPatch(cameraRoot)}`);
}
