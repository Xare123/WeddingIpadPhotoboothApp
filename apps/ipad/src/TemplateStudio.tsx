import { useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ActiveSession, CompositeRecipe, PhotoCrop } from './local-types';
import type { TemplateEditorState } from './template-editor';

export const TEMPLATE_THEMES = [
  { id: 'classic', name: 'Classic Ivory', paper: '#F6F0E4' },
  { id: 'botanical', name: 'Sage Botanical', paper: '#DCE5D6' },
  { id: 'coastal', name: 'Coastal Sea Glass', paper: '#DBEBE7' },
] as const;
type Inspection = { uri: string; width: number; height: number };
type Props = {
  state: TemplateEditorState; session: ActiveSession; landscape: boolean; saving: boolean;
  previewPresented: boolean; foreground: boolean; reduceMotion: boolean;
  onPreviewLoaded(uri: string): void; onPreviewError(uri: string): void;
  onBack(): void; onSave(): void; onRetryInspection(): void;
  onInspect(): Promise<Readonly<Inspection> | null>;
  onLayout(layout: CompositeRecipe['layout']): void; onTheme(theme: CompositeRecipe['theme']): void;
  onSwap(a: string, b: string): void; onCrop(id: string, crop: PhotoCrop): void;
  onCrops(crops: Record<string, PhotoCrop>): void;
};
export function TemplateStudio(p: Props) {
  const [adjust, setAdjust] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const [inspectionOpen, setInspectionOpen] = useState(false), [inspection, setInspection] = useState<Inspection | null>(null);
  const [inspectionFailed, setInspectionFailed] = useState(false), [fitWidth, setFitWidth] = useState(false);
  const inspectionGeneration = useRef(0), mounted = useRef(true);
  const { width } = useWindowDimensions(), insets = useSafeAreaInsets();
  const recipe = p.state.recipe, blocked = p.saving || p.state.phase === 'saving';
  const closeInspection = () => { inspectionGeneration.current++; setInspectionOpen(false); setInspection(null); setInspectionFailed(false); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; inspectionGeneration.current++; }; }, []);
  useEffect(() => { closeInspection(); }, [p.state.previewUri, p.foreground]);
  const openInspection = async () => {
    if (blocked || !p.previewPresented || p.state.phase !== 'ready') return;
    const generation = ++inspectionGeneration.current;
    setInspection(null); setInspectionFailed(false); setFitWidth(false); setInspectionOpen(true);
    const result = await p.onInspect().catch(() => null);
    if (!mounted.current || generation !== inspectionGeneration.current) return;
    if (result) setInspection(result); else setInspectionFailed(true);
  };
  const crop = selected && recipe ? recipe.cropsByPhotoId[selected] : undefined;
  const changeCrop = (delta: Partial<PhotoCrop>) => {
    if (!selected || !crop || blocked) return;
    const next = { ...crop, ...delta };
    next.x = Math.max(-1, Math.min(1, Math.round(next.x * 100) / 100)) || 0;
    next.y = Math.max(-1, Math.min(1, Math.round(next.y * 100) / 100)) || 0;
    next.zoom = Math.max(1, Math.min(1.5, Math.round(next.zoom * 100) / 100));
    p.onCrop(selected, next);
  };
  const header = <View style={s.header}><View><Text style={s.eyebrow}>FOUR PHOTOS. ONE KEEPSAKE.</Text><Text style={s.title}>Make it yours.</Text></View><Pressable accessibilityRole="button" disabled={blocked} testID="template-back" onPress={p.onBack} style={s.link}><Text style={s.linkText}>Review photos</Text></Pressable></View>;
  if (!recipe) return <View testID="template-studio" style={s.page}>
    {header}<View style={s.pending}><Text style={s.pendingTitle}>{p.state.phase === 'error' ? 'Your photos are still safe.' : 'Looking at your four photos…'}</Text><Text testID="template-status" accessibilityLiveRegion="polite" style={s.note}>{p.state.phase === 'error' ? 'The layout could not be prepared. Your originals are saved.' : 'Choosing a layout that suits your photos.'}</Text>{p.state.phase === 'error' && <Pressable testID="template-retry-inspection" accessibilityRole="button" onPress={p.onRetryInspection} style={s.link}><Text style={s.linkText}>Try again</Text></Pressable>}</View>
  </View>;
  const fullPhotos = recipe.photoIds.every(id => recipe.cropsByPhotoId[id]?.mode === 'fit');
  const filledPhotos = recipe.photoIds.every(id => recipe.cropsByPhotoId[id]?.mode === 'fill');
  const layoutDescription = recipe.layout === 'strip' ? 'Classic strip · 1:3' : recipe.version === 'wedding-template-v2' ? recipe.gridAspect === 'portrait' ? 'Social grid · Portrait 4:5' : 'Social grid · Square' : 'Four-cut grid';
  const imageError = () => { if (inspection) p.onPreviewError(inspection.uri); closeInspection(); };
  const inspectionWidth = Math.max(100, width - insets.left - insets.right - 32);
  return <View testID="template-studio" style={s.page}>
    {header}
    <View style={[s.body, p.landscape && s.bodyWide]}>
      <View style={s.previewColumn}>
        <View style={s.stage}>{p.state.previewUri ? <Image key={p.state.previewUri} testID="template-preview" source={{ uri: p.state.previewUri }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel="Rendered keepsake preview" onLoad={() => { if (p.state.previewUri) p.onPreviewLoaded(p.state.previewUri); }} onError={() => { if (p.state.previewUri) p.onPreviewError(p.state.previewUri); }} /> : <View style={s.pending}><Text style={s.pendingTitle}>{p.state.phase === 'error' ? 'Your photos are still safe.' : 'Making your keepsake…'}</Text><Text style={s.note}>{p.state.phase === 'error' ? 'Try a theme again or return to your photos.' : 'Preparing a preview from your four photos.'}</Text>{p.state.phase === 'error' && <Pressable testID="template-retry" accessibilityRole="button" onPress={() => p.onTheme(recipe.theme)} style={s.link}><Text style={s.linkText}>Retry preview</Text></Pressable>}</View>}</View>
        <View style={s.previewCaption}><Text style={s.format}>{layoutDescription}</Text><Pressable testID="template-inspect" accessibilityRole="button" accessibilityLabel="Inspect full-resolution keepsake" disabled={blocked || !p.previewPresented || p.state.phase !== 'ready'} onPress={() => void openInspection()} style={[s.link, (blocked || !p.previewPresented || p.state.phase !== 'ready') && s.disabled]}><Text style={s.linkText}>View larger</Text></Pressable></View>
      </View>
      <View style={[s.panel, p.landscape && s.panelWide]}>
        <ScrollView style={s.controlScroll} contentContainerStyle={s.controls} showsVerticalScrollIndicator>
          <View style={s.segment}>{(['strip', 'grid'] as const).map(layout => <Pressable key={layout} testID={`template-layout-${layout}`} accessibilityRole="button" accessibilityState={{ selected: recipe.layout === layout, disabled: blocked }} disabled={blocked} onPress={() => p.onLayout(layout)} style={[s.segmentButton, recipe.layout === layout && s.segmentSelected]}><Text style={[s.segmentText, recipe.layout === layout && s.segmentTextSelected]}>{layout === 'strip' ? 'Photo strip' : 'Four-cut grid'}</Text></Pressable>)}</View>
          <View style={s.themes}>{TEMPLATE_THEMES.map(theme => <Pressable key={theme.id} testID={`template-theme-${theme.id}`} accessibilityRole="button" accessibilityLabel={theme.name} accessibilityState={{ selected: recipe.theme === theme.id, disabled: blocked }} disabled={blocked} onPress={() => p.onTheme(theme.id)} style={[s.themeCard, { backgroundColor: theme.paper }, recipe.theme === theme.id && s.themeSelected]}>
            <View style={s.themePicture}>{p.state.themePreviews[theme.id] ? <Image key={p.state.themePreviews[theme.id]} testID={`template-theme-preview-${theme.id}`} source={{ uri: p.state.themePreviews[theme.id]! }} resizeMode="contain" style={StyleSheet.absoluteFill} accessibilityLabel={`${theme.name}, with your four photos`} onError={() => { const uri = p.state.themePreviews[theme.id]; if (uri) p.onPreviewError(uri); }} /> : <Text style={s.loadingSmall}>Preparing…</Text>}</View><Text style={s.themeName}>{theme.name}</Text>
          </Pressable>)}</View>
          <View style={s.placement}>
            <Text style={s.sectionLabel}>Photo placement</Text>
            <View style={s.segment}>{(['fit', 'fill'] as const).map(mode => <Pressable key={mode} testID={`template-placement-${mode}`} accessibilityRole="button" accessibilityState={{ selected: mode === 'fit' ? fullPhotos : filledPhotos, disabled: blocked }} disabled={blocked} style={[s.segmentButton, (mode === 'fit' ? fullPhotos : filledPhotos) && s.segmentSelected]} onPress={() => { setSelected(null); p.onCrops(Object.fromEntries(recipe.photoIds.map(id => [id, { mode, x: 0, y: mode === 'fill' ? -1 : 0, zoom: 1 }]))); }}><Text style={[s.segmentText, (mode === 'fit' ? fullPhotos : filledPhotos) && s.segmentTextSelected]}>{mode === 'fit' ? 'Full photo' : 'Fill frames'}</Text></Pressable>)}</View>
            <Text testID="template-placement-note" style={s.note}>{fullPhotos ? 'Every edge stays in view. Fill is optional.' : 'Fill starts at the top and crops edges. Check every face; originals stay unchanged.'}</Text>
          </View>
          <Pressable accessibilityRole="button" testID="template-adjust" accessibilityState={{ expanded: adjust, disabled: blocked }} disabled={blocked} onPress={() => { setAdjust(!adjust); setSelected(null); }} style={s.link}><Text style={s.linkText}>{adjust ? 'Done adjusting' : 'Adjust photos'}</Text></Pressable>
          {adjust && <View style={s.adjust}>
            <Text style={s.note}>Tap two photos to swap their places.</Text>
            <View style={s.photoRow}>{recipe.photoIds.map((id, index) => {
              const photo = p.session.shots.find(value => value.id === id);
              return <Pressable key={id} testID={`template-photo-${index + 1}`} accessibilityRole="button" accessibilityLabel={`Photo in position ${index + 1}`} accessibilityState={{ selected: selected === id, disabled: blocked }} disabled={blocked} onPress={() => {
                if (selected === id) setSelected(null);
                else if (selected) { p.onSwap(selected, id); setSelected(null); }
                else setSelected(id);
              }} style={[s.photo, selected === id && s.photoSelected]}>{photo && <Image source={{ uri: photo.fileUri }} resizeMode="cover" style={StyleSheet.absoluteFill} />}<Text style={s.photoNumber}>{index + 1}</Text></Pressable>;
            })}</View>
            {selected && crop && <View style={s.crop}>
              <Text style={s.sectionLabel}>Frame the selected photo</Text>
              <View style={s.segment}>{(['fit', 'fill'] as const).map(mode => <Pressable key={mode} testID={`template-crop-${mode}`} accessibilityRole="button" accessibilityState={{ selected: crop.mode === mode, disabled: blocked }} disabled={blocked} style={[s.segmentButton, crop.mode === mode && s.segmentSelected]} onPress={() => p.onCrop(selected, { mode, x: 0, y: mode === 'fill' ? -1 : 0, zoom: 1 })}><Text style={[s.segmentText, crop.mode === mode && s.segmentTextSelected]}>{mode === 'fit' ? 'Full photo' : 'Fill frame'}</Text></Pressable>)}</View>
              {crop.mode === 'fill' && <><Text style={s.note}>Fill starts at the top. Adjust the framing; your original stays untouched.</Text><View style={s.panRow}>{[
                ['left', '←', { x: crop.x - 0.25 }], ['up', '↑', { y: crop.y - 0.25 }], ['down', '↓', { y: crop.y + 0.25 }], ['right', '→', { x: crop.x + 0.25 }],
              ].map(([name, text, delta]) => <Pressable key={String(name)} testID={`template-pan-${name}`} accessibilityRole="button" accessibilityLabel={`Move crop ${name}`} disabled={blocked} style={s.panButton} onPress={() => changeCrop(delta as Partial<PhotoCrop>)}><Text style={s.panText}>{String(text)}</Text></Pressable>)}</View><View style={s.zoomRow}><Pressable testID="template-zoom-out" accessibilityRole="button" accessibilityLabel="Zoom out" disabled={blocked || crop.zoom <= 1} onPress={() => changeCrop({ zoom: crop.zoom - 0.1 })} style={s.panButton}><Text style={s.panText}>−</Text></Pressable><Text style={s.note}>{Math.round(crop.zoom * 100)}%</Text><Pressable testID="template-zoom-in" accessibilityRole="button" accessibilityLabel="Zoom in" disabled={blocked || crop.zoom >= 1.5} onPress={() => changeCrop({ zoom: crop.zoom + 0.1 })} style={s.panButton}><Text style={s.panText}>+</Text></Pressable></View></>}
            </View>}
          </View>}
        </ScrollView>
        <View style={s.commitArea}>
          <Text testID="template-status" accessibilityLiveRegion="polite" style={s.note}>{blocked ? 'Saving your full-size keepsake…' : p.state.phase === 'ready' && p.previewPresented ? 'Ready to keep' : p.state.phase === 'error' ? 'Your originals are saved. This preview needs a retry.' : 'Preparing your preview…'}</Text>
          <Pressable testID="template-save" accessibilityRole="button" accessibilityState={{ disabled: blocked || p.state.phase !== 'ready' || !p.previewPresented }} disabled={blocked || p.state.phase !== 'ready' || !p.previewPresented} onPress={p.onSave} style={[s.save, (blocked || p.state.phase !== 'ready' || !p.previewPresented) && s.disabled]}><Text style={s.saveText}>{blocked ? 'Saving keepsake…' : 'Save keepsake'}</Text></Pressable>
          <Text style={s.privacy}>Keepsake + four originals. Your private link appears after upload.</Text>
        </View>
      </View>
    </View>
    <Modal visible={inspectionOpen && p.foreground} animationType={p.reduceMotion ? 'none' : 'fade'} supportedOrientations={['portrait', 'landscape']} onRequestClose={closeInspection}>
      <View testID="template-inspector" accessibilityViewIsModal style={[s.inspector, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8, paddingLeft: insets.left, paddingRight: insets.right }]}>
        <View style={s.inspectionHeader}><View><Text style={s.eyebrow}>YOUR KEEPSAKE</Text><Text style={s.inspectionTitle}>A closer look.</Text></View><Pressable testID="template-inspect-done" accessibilityRole="button" onPress={closeInspection} style={s.link}><Text style={s.linkText}>Done</Text></Pressable></View>
        {inspection ? <><View style={[s.segment, s.inspectionSegment]}>{[false, true].map(wide => <Pressable key={String(wide)} testID={wide ? 'template-inspect-width' : 'template-inspect-whole'} accessibilityRole="button" accessibilityState={{ selected: fitWidth === wide }} onPress={() => setFitWidth(wide)} style={[s.segmentButton, fitWidth === wide && s.segmentSelected]}><Text style={[s.segmentText, fitWidth === wide && s.segmentTextSelected]}>{wide ? 'Fit width · scroll' : 'Whole keepsake'}</Text></Pressable>)}</View>{fitWidth ? <ScrollView testID="template-inspect-scroll" style={s.inspectionBody} contentContainerStyle={s.inspectionContent}><Image key={inspection.uri} testID="template-inspect-image" source={{ uri: inspection.uri }} resizeMode="contain" style={{ width: inspectionWidth, height: inspectionWidth * inspection.height / inspection.width }} onError={imageError} accessibilityLabel="Full-resolution saved-style keepsake preview, scroll to inspect all four photos" /></ScrollView> : <View style={s.inspectionBody}><Image key={inspection.uri} testID="template-inspect-image" source={{ uri: inspection.uri }} resizeMode="contain" style={StyleSheet.absoluteFill} onError={imageError} accessibilityLabel="Full-resolution keepsake preview" /></View>}<Text style={[s.note, s.inspectionNote]}>Full-resolution preview · {inspection.width} × {inspection.height} pixels</Text></> : <View style={s.pending}><Text style={s.pendingTitle}>{inspectionFailed ? 'The larger preview needs a retry.' : 'Preparing every detail…'}</Text><Text style={s.note}>Your originals stay saved. Done returns to your layout.</Text>{inspectionFailed && p.state.phase === 'ready' && <Pressable testID="template-inspect-retry" accessibilityRole="button" onPress={() => void openInspection()} style={s.link}><Text style={s.linkText}>Retry larger preview</Text></Pressable>}</View>}
      </View>
    </Modal>
  </View>;
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F0E8' }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, paddingHorizontal: 26, paddingTop: 10, paddingBottom: 12 }, eyebrow: { color: '#63705B', fontSize: 10, fontWeight: '600', letterSpacing: 1.5, marginBottom: 6 }, title: { color: '#2D392F', fontFamily: 'Georgia', fontSize: 33 },
  body: { flex: 1, paddingHorizontal: 20, paddingBottom: 12, gap: 14 }, bodyWide: { flexDirection: 'row' }, previewColumn: { flex: 1, minHeight: 240 }, stage: { flex: 1, minHeight: 180, backgroundColor: '#E6E0D6', borderRadius: 16, overflow: 'hidden' }, previewCaption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, format: { color: '#53614F', fontSize: 12 }, pending: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 16 }, pendingTitle: { fontFamily: 'Georgia', color: '#354B38', fontSize: 25, textAlign: 'center' },
  panel: { maxHeight: '50%', flexShrink: 1, gap: 10 }, panelWide: { width: 356, maxHeight: '100%', flexShrink: 0 }, controlScroll: { flexShrink: 1, flexGrow: 0 }, controls: { gap: 12, paddingBottom: 4 }, commitArea: { gap: 7, flexShrink: 0, paddingTop: 4 }, segment: { backgroundColor: '#E5E3D8', borderRadius: 16, flexDirection: 'row', padding: 4, gap: 4 }, segmentButton: { minHeight: 48, flex: 1, borderRadius: 12, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center' }, segmentSelected: { backgroundColor: '#314D3B' }, segmentText: { color: '#43533F', fontSize: 14, fontWeight: '600' }, segmentTextSelected: { color: '#fff' },
  sectionLabel: { color: '#3D4D39', fontSize: 12, fontWeight: '600', textAlign: 'center' }, themes: { flexDirection: 'row', gap: 8 }, themeCard: { flex: 1, borderRadius: 14, padding: 7, borderWidth: 1, borderColor: '#ADB5A4', gap: 5 }, themeSelected: { borderWidth: 3, borderColor: '#456144', padding: 5 }, themePicture: { height: 86, alignItems: 'center', justifyContent: 'center' }, themeName: { color: '#344B38', fontWeight: '600', fontSize: 11, lineHeight: 16, minHeight: 32, textAlign: 'center' }, loadingSmall: { color: '#5A6A54', fontSize: 10 }, placement: { gap: 6 },
  link: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' }, linkText: { color: '#3B5C3D', fontSize: 14, fontWeight: '600' }, note: { color: '#53614F', fontSize: 12, lineHeight: 18, textAlign: 'center' }, privacy: { color: '#596451', fontSize: 11, lineHeight: 16, textAlign: 'center' }, save: { minHeight: 60, borderRadius: 16, backgroundColor: '#314D3B', alignItems: 'center', justifyContent: 'center', padding: 16 }, saveText: { color: '#fff', fontSize: 18, fontWeight: '600' }, disabled: { opacity: 0.4 },
  adjust: { gap: 12, borderTopWidth: 1, borderTopColor: '#D1D2C4', paddingTop: 12 }, photoRow: { flexDirection: 'row', gap: 8 }, photo: { flex: 1, height: 76, minWidth: 44, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#84977D' }, photoSelected: { borderWidth: 3, borderColor: '#314D3B' }, photoNumber: { position: 'absolute', bottom: 3, right: 3, backgroundColor: '#FCF8EC', color: '#26432A', borderRadius: 9, paddingHorizontal: 6, paddingVertical: 2, fontSize: 11, fontWeight: '700' }, crop: { gap: 10 }, panRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 }, panButton: { minWidth: 48, minHeight: 48, borderWidth: 1, borderColor: '#9EAE93', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, panText: { color: '#34533A', fontSize: 22 }, zoomRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 20 },
  inspector: { flex: 1, backgroundColor: '#F5F0E8' }, inspectionHeader: { paddingHorizontal: 22, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, inspectionTitle: { fontFamily: 'Georgia', color: '#2D392F', fontSize: 28 }, inspectionSegment: { marginHorizontal: 16, marginBottom: 12 }, inspectionBody: { flex: 1, minHeight: 100, backgroundColor: '#E6E0D6' }, inspectionContent: { paddingHorizontal: 16, paddingVertical: 16, alignItems: 'center' }, inspectionNote: { paddingTop: 10, paddingHorizontal: 16 },
});
