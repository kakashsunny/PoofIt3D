import React, { useEffect, useState } from 'react';
import './styles/App.css';
import './styles/ColorblindMode.css';
import './styles/Premium.css';
import DrawingCanvas from './components/DrawingCanvas';
import StyleSelector from './components/StyleSelector';
import ModelSelector from './components/ModelSelector';
import ImageResult from './components/ImageResult';
import Notification from './components/Notification';
import ColorblindToggle from './components/ColorblindToggle';
import { ResetProvider } from './ResetContext';
import { ColorblindProvider } from './ColorblindContext';
import { fetchStyles, fetchModels } from './services/api';
import { Style, Model, GenerationResult } from './types';

const Mark: React.FC = () => <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>;

const App: React.FC = () => {
  const [styles, setStyles] = useState<Style[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedStyle, setSelectedStyle] = useState<Style | null>(null);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [description, setDescription] = useState('');
  const [generationResult, setGenerationResult] = useState<GenerationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [notification, setNotification] = useState<{show: boolean; message: string; type: 'error' | 'info' | 'success'}>({ show: false, message: '', type: 'info' });

  const showNotification = (message: string, type: 'error' | 'info' | 'success') => setNotification({ show: true, message, type });

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [stylesData, modelsData] = await Promise.all([fetchStyles(), fetchModels()]);
        setStyles(stylesData);
        setModels(modelsData);
        setSelectedStyle(stylesData.find(style => style.id === 'photorealistic') || stylesData[0] || null);
        setSelectedModel(modelsData.find(model => model.id.includes('sdxl-1.0')) || modelsData[0] || null);
      } catch (error) {
        console.error('Failed to fetch initial data:', error);
        showNotification('Could not reach the PoofIt3D API. Check your connection and try again.', 'error');
      }
    };
    loadOptions();
  }, []);

  const currentStep = generationResult?.status === 'completed' ? 3 : generationResult?.status === 'processing' ? 2 : 1;

  return (
    <ColorblindProvider>
      <ResetProvider>
        <div className="app-shell">
          {notification.show && <Notification message={notification.message} type={notification.type} onClose={() => setNotification(prev => ({ ...prev, show: false }))} />}
          <aside className="sidebar">
            <a className="brand" href="#create" aria-label="PoofIt3D home"><Mark /><span>poofit<span className="brand-accent">3d</span></span></a>
            <div className="workspace-label">WORKSPACE</div>
            <nav className="main-nav" aria-label="Main navigation">
              <a href="#create" className="nav-item active" aria-current="page"><span className="nav-glyph">✳</span><span>Create</span><span className="nav-current" /></a>
              <button className="nav-item" type="button" disabled title="Project history is not available yet"><span className="nav-glyph">▤</span><span>My projects</span><span className="nav-soon">Soon</span></button>
              <button className="nav-item" type="button" disabled title="Gallery is not available yet"><span className="nav-glyph">▦</span><span>Gallery</span><span className="nav-soon">Soon</span></button>
              <button className="nav-item" type="button" disabled title="Settings are not available yet"><span className="nav-glyph">⚙</span><span>Settings</span><span className="nav-soon">Soon</span></button>
            </nav>
            <div className="sidebar-bottom">
              <div className="pipeline-note"><span className="status-dot" /><div><strong>AI pipeline</strong><small>Connected when API is online</small></div></div>
              <ColorblindToggle />
              <div className="sidebar-version">POOFIT3D <span>·</span> CREATIVE STUDIO</div>
            </div>
          </aside>

          <main className="app-main" id="create">
            <header className="topbar">
              <div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>Create</strong></div>
              <div className="topbar-right"><span className="autosave-indicator"><i /> Ready to create</span><span className="topbar-divider" /><button className="help-link" type="button" onClick={() => showNotification('Draw or upload a sketch, describe the materials, then generate and approve an image before creating your 3D model.', 'info')}>How it works <span>↗</span></button></div>
            </header>

            <div className="page-content">
              <section className="page-heading">
                <div><div className="eyebrow">SKETCH TO 3D · CREATIVE WORKSPACE</div><h1>Bring your ideas <span>into shape.</span></h1><p>Start with a sketch. Refine the look. Step into 3D.</p></div>
                <div className="heading-badge"><span className="badge-orb">✳</span><span><strong>From 2D to 3D</strong><small>One guided workflow</small></span></div>
              </section>

              <section className="workflow-strip" aria-label="Creation workflow">
                {[['01', 'Sketch'], ['02', 'Enhance'], ['03', 'Approve'], ['04', 'Explore 3D']].map(([number, label], index) => <div className={`workflow-step ${currentStep > index + 1 ? 'is-active' : ''} ${currentStep === index + 1 ? 'is-current' : ''}`} key={number}><span className="step-number">{currentStep > index + 1 ? '✓' : number}</span><span>{label}</span>{index < 3 && <span className="step-connector" />}</div>)}
              </section>

              <div className="creation-layout">
                <section className="canvas-card panel-card">
                  <div className="panel-heading"><div><span className="section-kicker">01 — YOUR INPUT</span><h2>Sketch your idea</h2><p>Draw on the canvas or bring in a sketch you already have.</p></div><span className="live-pill"><i /> Canvas ready</span></div>
                  <DrawingCanvas
                    selectedStyle={selectedStyle} selectedModel={selectedModel} styles={styles} models={models}
                    description={description} setDescription={setDescription} setSelectedStyle={setSelectedStyle}
                    setSelectedModel={setSelectedModel} setGenerationResult={setGenerationResult} setIsLoading={setIsLoading}
                    showNotification={showNotification}
                  />
                </section>

                <aside className="settings-card panel-card">
                  <div className="panel-heading settings-heading"><div><span className="section-kicker">02 — ART DIRECTION</span><h2>Set the mood</h2><p>Guide how your sketch comes to life.</p></div></div>
                  <div className="setting-block"><ModelSelector models={models} selectedModel={selectedModel} setSelectedModel={setSelectedModel} /></div>
                  <div className="setting-divider" />
                  <div className="setting-block"><StyleSelector styles={styles} selectedStyle={selectedStyle} setSelectedStyle={setSelectedStyle} /></div>
                  <div className="setting-divider" />
                  <div className="setting-block prompt-block"><label className="field-label" htmlFor="description">Materials & details <span>OPTIONAL</span></label><textarea id="description" className="modern-textarea" value={description} maxLength={1000} onChange={event => setDescription(event.target.value)} placeholder="Warm cedar, soft daylight, brushed metal…" rows={4} /><div className="field-footnote"><span>Specific details help shape your result.</span><span>{description.length}/1000</span></div></div>
                  <div className="settings-tip"><span className="tip-icon">✳</span><p><strong>Good to know</strong><br />You can review and approve the enhanced image before any 3D generation begins.</p></div>
                </aside>
              </div>

              <section className="results-card panel-card" aria-label="Generated results">
                <div className="results-heading"><div><span className="section-kicker">03 — YOUR CREATION</span><h2>Preview & build</h2><p>Your enhanced image and 3D model will appear here.</p></div><span className="secure-note"><span>◇</span> Your work stays in this session</span></div>
                {isLoading && <div className="request-banner" role="status"><span className="loading-ring" /><div><strong>Preparing your enhancement</strong><small>Sending your sketch to the image pipeline…</small></div></div>}
                <ImageResult generationResult={generationResult} setIsLoading={setIsLoading} setGenerationResult={setGenerationResult} />
              </section>
              <footer className="page-footer"><span>Made for ideas that deserve more dimension.</span><span>PoofIt3D <b>·</b> Sketch to 3D</span></footer>
            </div>
          </main>
        </div>
      </ResetProvider>
    </ColorblindProvider>
  );
};

export default App;
