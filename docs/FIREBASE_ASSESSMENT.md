# Bounded Firebase assessment

Firebase testing is authorized, but it is not a prerequisite for continuing the native build or owner iPad rehearsal. No Firebase matrix, cloud project, service account, credential, billing plan or paid run was created.

## Access and artifact checks

The selected cloud runtime reports no outbound Google identity. Its supported version-1 identity manifest has `connections: []`, so there is no intended Google profile/project to select. Generic Google SDK variable names are present, but that is not evidence of a usable authorized identity. Credential files were not read or copied. The Google Cloud/Firebase CLIs and Xcode are absent on this Linux host; no interactive login was attempted.

Firebase iOS testing uses a compatible native XCTest/XCUITest package, not a JavaScript test report or an Expo/Hermes bundle. A simulator build is not a signed physical-device test package. The new native test target is therefore useful preparation, but no Firebase-compatible signed artifact or selected test project is available here.

## Official references and current-status limit

- [Run XCTest with Firebase Test Lab](https://firebase.google.com/docs/test-lab/ios/run-xctest)
- [iOS setup](https://firebase.google.com/docs/test-lab/ios/get-started)
- [Migration FAQ](https://firebase.google.com/docs/test-lab/migrate-faq)

These official hosts are outside this executor's current allowed destinations. Current service availability, migration dates, device inventory, signing rules and quotas have not been independently refreshed here. Do not treat this note as proof that the present Expo build is accepted by Firebase, or work around the network policy to fetch/upload it.

If Firebase is revisited, first verify those official requirements and current iOS availability, select an already-authorized project/identity, review quota/billing, and produce the required signed native test package. Any new credentials, grants, terms or paid commitment need the owner's specific approval. Do not upload production keys, phone numbers or real guest photos.

The practical path for this phase is standard free public-repository GitHub Linux/macOS testing, followed by the owner Mac-to-iPad checklist. The repository was verified public read-only; no visibility change was made. Actual hosted run results are recorded in [validation](VALIDATION.md); simulator fixtures never establish real camera or venue readiness.
