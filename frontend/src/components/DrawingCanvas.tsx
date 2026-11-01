import React, { ChangeEvent, DragEvent, useEffect, useRef, useState } from 'react';
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw';
import { generateImage } from '../services/api';
import { Style, Model, GenerationResult } from '../types';
import { useReset } from '../ResetContext';

interface DrawingCanvasProps {
  selectedStyle: Style | null;
  selectedModel: Model | null;
  styles: Style[];
  models: Model[];
  description: string;
  setDescription: React.Dispatch<React.SetStateAction<string>>;
  setSelectedStyle: React.Dispatch<React.SetStateAction<Style | null>>;
  setSelectedModel: React.Dispatch<React.SetStateAction<Model | null>>;
  setGenerationResult: React.Dispatch<React.SetStateAction<GenerationResult | null>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  showNotification: (message: string, type: 'error' | 'info' | 'success') => void;
}

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
  selectedStyle, selectedModel, styles, models, description,
  setDescription, setSelectedStyle, setSelectedModel, setGenerationResult,
  setIsLoading, showNotification,
}) => {
  const excalidrawRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { triggerReset } = useReset();

  useEffect(() => {
    if (!uploadedFile) { setPreviewUrl(''); return; }
    const url = URL.createObjectURL(uploadedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [uploadedFile]);

  const selectFile = (file?: File) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      showNotification('Choose a PNG, JPEG, or WEBP image.', 'error');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      showNotification('Sketches must be 12 MB or smaller.', 'error');
      return;
    }
    setUploadedFile(file);
    setGenerationResult(null);
    triggerReset();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0]);
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    selectFile(event.dataTransfer.files?.[0]);
  };

  const removeFile = () => {
    setUploadedFile(null);
    setGenerationResult(null);
    triggerReset();
  };

  const handleGenerate = async () => {
    if (!selectedStyle || !selectedModel || isSubmitting) return;
    try {
      let sketchFile = uploadedFile;
      if (!sketchFile) {
        const scene = excalidrawRef.current?.getSceneElements();
        if (!scene?.length) {
          showNotification('Draw something or upload a sketch to get started.', 'info');
          return;
        }
        const appState = excalidrawRef.current.getAppState();
        const blob = await exportToBlob({
          elements: scene,
          appState: { ...appState, exportWithDarkMode: false, exportBackground: true, viewBackgroundColor: '#ffffff' },
          mimeType: 'image/png', files: null,
        });
        sketchFile = new File([blob], 'sketch.png', { type: 'image/png' });
      }
      setIsSubmitting(true);
      setIsLoading(true);
      const result = await generateImage(sketchFile, selectedStyle.id, selectedModel.id, description);
      setGenerationResult(result);
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to generate image:', error);
      setIsLoading(false);
      showNotification('Enhancement could not start. Check the API connection and retry.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    excalidrawRef.current?.resetScene();
    setUploadedFile(null);
    setDescription('');
    setSelectedStyle(styles.find(style => style.id === 'photorealistic') || styles[0] || null);
    setSelectedModel(models.find(model => model.id === 'controlnet_scribble') || models[0] || null);
    setGenerationResult(null);
    triggerReset();
  };

  return (
    <div className="drawing-workspace">
      <div className="source-switch-row"><span className="source-label">YOUR SKETCH</span><button type="button" className="upload-trigger" onClick={() => fileInputRef.current?.click()}><span className="upload-icon">↑</span> Upload image</button>
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} hidden aria-label="Upload sketch image" />
      </div>
      <div className={`upload-dropzone ${isDragging ? 'is-dragging' : ''} ${uploadedFile ? 'has-file' : ''}`} onDragOver={event => { event.preventDefault(); setIsDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false); }} onDrop={handleDrop}>
        {uploadedFile ? <div className="uploaded-sketch"><img src={previewUrl} alt="Uploaded sketch preview" /><div className="uploaded-file-meta"><strong>{uploadedFile.name}</strong><span>{(uploadedFile.size / 1024 / 1024).toFixed(2)} MB · Ready to enhance</span></div><button className="icon-action" type="button" aria-label="Remove uploaded sketch" title="Remove sketch" onClick={removeFile}>×</button></div> : <div className="drop-prompt"><span className="drop-glyph">↥</span><span><strong>Drop a sketch here</strong><small>PNG, JPG or WEBP · up to 12 MB <button type="button" className="text-link" onClick={() => fileInputRef.current?.click()}>Browse files</button></small></span><span className="draw-alternative">or draw below</span></div>}
      </div>
      <div className="excalidraw-shell" aria-label="Sketch drawing canvas">
        <Excalidraw ref={excalidrawRef} initialData={{ appState: { viewBackgroundColor: '#ffffff', activeTool: { type: 'freedraw', lastActiveTool: null, locked: false, customType: null }, currentItemStrokeWidth: 2 } as any }} UIOptions={{ canvasActions: { changeViewBackgroundColor: false, export: false, loadScene: false, saveToActiveFile: false, saveAsImage: false, toggleTheme: false } }} />
      </div>
      <div className="canvas-actions"><div className="canvas-hint"><span className="hint-spark">✳</span> Simple shapes and clear outlines work best.</div><div className="action-group"><button className="subtle-button" type="button" onClick={handleReset}>Reset</button><button className="generate-button" type="button" onClick={handleGenerate} disabled={!selectedStyle || !selectedModel || isSubmitting}>{isSubmitting ? <><span className="button-spinner" /> Enhancing…</> : <><span className="button-spark">✳</span> Enhance sketch <span className="button-arrow">→</span></>}</button></div></div>
    </div>
  );
};

export default DrawingCanvas;
