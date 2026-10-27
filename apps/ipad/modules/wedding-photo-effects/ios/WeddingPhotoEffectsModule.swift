import ExpoModulesCore
import Foundation

struct TemplatePhotoSource: Record {
  @Field var photoId: String = ""
  @Field var uri: String = ""
}

public final class WeddingPhotoEffectsModule: Module {
  private let treatments = PhotoTreatmentEngine(cacheDirectory:
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("WeddingTreatments", isDirectory: true), originalsDirectory:
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("photobooth", isDirectory: true))
  private let templates = PhotoTemplateEngine(cacheDirectory:
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("WeddingTemplates", isDirectory: true))
  private let engine = PhotoEffectsEngine(cacheDirectory:
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("WeddingPhotoEffects", isDirectory: true))
  private func checkedTemplateSources(_ sources: [TemplatePhotoSource]) throws -> [PhotoTemplateEngine.Source] {
    guard sources.count == 4, Set(sources.map { $0.photoId }).count == 4 else { throw PhotoTemplateEngine.Failure.invalidInput }
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("photobooth", isDirectory: true).standardizedFileURL.resolvingSymlinksInPath()
    return try sources.map { source in
      guard source.photoId.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", options: .regularExpression) != nil,
        let url = URL(string: source.uri), url.isFileURL, url.host == nil || url.host == "",
        url.query == nil, url.fragment == nil, !source.uri.contains("%00") else { throw PhotoTemplateEngine.Failure.invalidInput }
      let resolved = url.standardizedFileURL.resolvingSymlinksInPath()
      guard resolved.deletingLastPathComponent() == documents,
        resolved.lastPathComponent == source.photoId + ".jpg" else { throw PhotoTemplateEngine.Failure.invalidInput }
      return PhotoTemplateEngine.Source(photoId: source.photoId, url: resolved)
    }
  }
  public func definition() -> ModuleDefinition {
    Name("WeddingPhotoEffects")
    Constant("capabilityVersion") { 1 }
    Constant("treatmentVersion") { PhotoTreatmentEngine.version }
    AsyncFunction("renderTreatment") { (sourceUri: String, recipeJSON: String, requestUUID: String, promise: Promise) in
      guard let source = URL(string: sourceUri), let id = UUID(uuidString: requestUUID) else {
        promise.reject("ERR_PHOTO_TREATMENT_INVALIDINPUT", "Invalid photo treatment request."); return
      }
      self.treatments.render(source: source, recipeJSON: recipeJSON, id: id) { result in
        switch result {
        case .success(let output): promise.resolve(output.dictionary)
        case .failure(let failure):
          promise.reject("ERR_PHOTO_TREATMENT_" + String(describing: failure).uppercased(), "Photo treatment could not complete.")
        }
      }
    }
    Function("cancelTreatment") { (requestUUID: String) in
      guard let id = UUID(uuidString: requestUUID) else { throw PhotoTreatmentEngine.Failure.invalidInput }
      self.treatments.cancel(id)
    }
    AsyncFunction("releaseTreatment") { (uri: String) in
      guard let url = URL(string: uri) else { throw PhotoTreatmentEngine.Failure.invalidInput }
      try self.treatments.release(url)
    }
    Constant("templateVersion") { PhotoTemplateEngine.currentVersion }
    Constant("supportedTemplateVersions") { PhotoTemplateEngine.supportedVersions }
    AsyncFunction("inspectTemplateSources") { (sources: [TemplatePhotoSource]) -> [String: Any] in
      return try self.templates.inspect(sources: self.checkedTemplateSources(sources)).dictionary
    }
    AsyncFunction("renderTemplate") { (sources: [TemplatePhotoSource], recipeJSON: String, preview: Bool, requestUUID: String) -> [String: Any] in
      guard sources.count == 4, let id = UUID(uuidString: requestUUID) else { throw PhotoTemplateEngine.Failure.invalidInput }
      let checked = try self.checkedTemplateSources(sources)
      return try self.templates.render(sources: checked, recipeJSON: recipeJSON, preview: preview, id: id).dictionary
    }
    Function("cancelTemplate") { (requestUUID: String) in
      guard let id = UUID(uuidString: requestUUID) else { throw PhotoTemplateEngine.Failure.invalidInput }
      self.templates.cancel(id)
    }
    AsyncFunction("releaseTemplate") { (uri: String) in
      guard let url = URL(string: uri) else { throw PhotoTemplateEngine.Failure.invalidInput }
      try self.templates.release(url)
    }
    Constant("recipeVersion") { PhotoEffectsEngine.recipeVersion }
    Constant("presets") { PhotoEffectsEngine.presets }
    AsyncFunction("render") { (sourceUri: String, preset: String, intensity: Double, preview: Bool, requestID: String) -> [String: Any] in
      guard let id = UUID(uuidString: requestID), let source = URL(string: sourceUri), source.isFileURL else {
        throw PhotoEffectsEngine.Failure.invalidInput
      }
      let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("photobooth", isDirectory: true).standardizedFileURL.resolvingSymlinksInPath()
      let resolved = source.standardizedFileURL.resolvingSymlinksInPath()
      guard resolved.deletingLastPathComponent() == documents,
        ["jpg", "jpeg"].contains(resolved.pathExtension.lowercased()),
        !source.lastPathComponent.hasPrefix("."), !source.absoluteString.contains("%00") else {
        throw PhotoEffectsEngine.Failure.invalidInput
      }
      return try self.engine.render(source: resolved, preset: preset, intensity: intensity, preview: preview, id: id).dictionary
    }
    Function("cancel") { (requestID: String) in
      guard let id = UUID(uuidString: requestID) else { throw PhotoEffectsEngine.Failure.invalidInput }
      self.engine.cancel(id)
    }
    // Asynchronous release cannot block the JS thread behind an in-flight GPU render.
    AsyncFunction("release") { (uri: String) in
      guard let url = URL(string: uri) else { throw PhotoEffectsEngine.Failure.invalidInput }
      try self.engine.release(url)
    }
  }
}
