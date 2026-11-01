import { apiUrl } from '../services/api';
import React, { useEffect, useRef, useState } from 'react';
import { GenerationResult } from '../types';
import { checkGenerationStatus, generate3DModel, ThreeDResult } from '../services/api';
import { useReset } from '../ResetContext';
import Icon from './Icon';
import ThreeModelViewer from './ThreeModelViewer';

interface ProgressData {
  current_step: number;
  total_steps: number;
  percentage: number;
  stage: string;
  eta_seconds?: number;
  intermediate_image?: string;
}

interface ImageResultProps {
  generationResult: GenerationResult | null;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setGenerationResult: React.Dispatch<React.SetStateAction<GenerationResult | null>>;
  onRegenerate?: () => void;
}

const ImageResult: React.FC<ImageResultProps> = ({ 
  generationResult, 
  setIsLoading,
  setGenerationResult,
  onRegenerate 
}) => {
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [showQRCode, setShowQRCode] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [isGenerating3D, setIsGenerating3D] = useState(false);
  const [threeDResult, setThreeDResult] = useState<ThreeDResult | null>(null);
  const [threeDError, setThreeDError] = useState<string>('');
  const [approvedImageIndex, setApprovedImageIndex] = useState<number | null>(null);
  const threeDRequestInFlight = useRef(false);
  const { resetTrigger } = useReset();

  useEffect(() => {
    if (resetTrigger > 0) {
      setResult(null);
      setGenerationResult(null);
      setSelectedImageIndex(0);
      setImageUrls([]);
      setProgress(null);
      setShowQRCode(false);
      setQrCodeUrl('');
      setThreeDResult(null);
      setThreeDError('');
      setApprovedImageIndex(null);
    }
  }, [resetTrigger, setGenerationResult]);

  useEffect(() => {
    if (generationResult) {
      setResult(generationResult);
      setSelectedImageIndex(0);
      setImageUrls([]);
      setProgress(null);
      setShowQRCode(false);
      setQrCodeUrl('');
      setThreeDResult(null);
      setThreeDError('');
      setApprovedImageIndex(null);
      
      if (generationResult.status === 'processing') {
        setIsLoading(false); // Turn off any old loading overlay
        startProgressStream(generationResult.generation_id);
      } else if (generationResult.status === 'completed' && generationResult.image_url) {
        generateImageUrls(generationResult.generation_id, generationResult.image_url);
      }
    }
  // startProgressStream is declared below and only uses stable state setters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generationResult, setIsLoading]);

  useEffect(() => {
    const best = result?.quality?.best_index;
    if (typeof best === 'number') setSelectedImageIndex(best);
  }, [result?.quality?.best_index, result?.generation_id]);

  const startProgressStream = (generationId: string) => {
    const eventSource = new EventSource(apiUrl(`/progress/${generationId}`));

    eventSource.onopen = () => {
      console.log('Progress stream connected');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'connected':
            console.log('Connected to progress stream');
            break;
            
          case 'progress':
            setProgress({
              current_step: data.current_step,
              total_steps: data.total_steps,
              percentage: data.percentage,
              stage: data.stage,
              eta_seconds: data.eta_seconds,
              intermediate_image: data.intermediate_image
            });
            break;
            
          case 'completed':
            console.log('Generation completed');
            eventSource.close();
            setProgress(null);
            handleProgressComplete(generationId);
            break;
            
          case 'error':
            eventSource.close();
            setProgress(null);
            setResult({
              generation_id: generationId,
              status: 'failed',
              message: data.message || 'Image generation failed. Please try again.'
            });
            break;

          case 'timeout':
            console.log('Progress stream timed out');
            eventSource.close();
            setProgress(null);
            break;
            
          default:
            console.log('Unknown message type:', data.type);
        }
      } catch (error) {
        console.error('Error parsing progress data:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('EventSource error:', error);
      eventSource.close();
    };
  };

  const handleProgressComplete = async (generationId: string) => {
    try {
      const updatedResult = await checkGenerationStatus(generationId);
      setResult(updatedResult);
      
      if (updatedResult.status === 'completed' && updatedResult.image_url) {
        generateImageUrls(updatedResult.generation_id, updatedResult.image_url);
      }
    } catch (error) {
      console.error('Error checking final status:', error);
    }
  };

  const generateImageUrls = (generationId: string, firstImageUrl: string) => {
    // Check if this is a multi-image result (ends with _1)
    if (firstImageUrl.includes('_1')) {
      // Generate URLs for 3 images
      const urls = [];
      for (let i = 1; i <= 3; i++) {
        urls.push(apiUrl(`/images/${generationId}_${i}`));
      }
      setImageUrls(urls);
    } else {
      // Single image result
      setImageUrls([apiUrl(firstImageUrl)]);
    }
  };

  const handleDownload = () => {
    if (imageUrls[selectedImageIndex]) {
      const imageUrl = imageUrls[selectedImageIndex];
      
      const link = document.createElement('a');
      link.href = imageUrl;
      link.download = `generated-image-${selectedImageIndex + 1}-${new Date().getTime()}.png`;
      
      fetch(imageUrl)
        .then(response => response.blob())
        .then(blob => {
          const url = URL.createObjectURL(blob);
          link.href = url;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        })
        .catch(error => {
          console.error('Error downloading image:', error);
        });
    }
  };

  const handleShare = () => {
    if (result?.generation_id) {
      const imageIndex = selectedImageIndex + 1;
      const qrUrl = apiUrl(`/share/${result.generation_id}?image_index=${imageIndex}`);
      setQrCodeUrl(qrUrl);
      setShowQRCode(true);
    }
  };

  const handleMaximize = () => {
    setIsMaximized(true);
  };

  const handleCloseMaximized = () => {
    setIsMaximized(false);
  };

  const handleCloseQRCode = () => {
    setShowQRCode(false);
  };

  const handleThumbnailClick = (index: number) => {
    if (isGenerating3D) return;
    setSelectedImageIndex(index);
    setApprovedImageIndex(null);
    setThreeDResult(null);
    setThreeDError('');
  };

  const getStageDisplay = (stage: string) => {
    switch (stage) {
      case 'initializing':
        return 'Initializing...';
      case 'loading model':
        return 'loading AI model...';
      case 'preprocessing sketch':
        return 'processing sketch...';
      case 'starting generation':
        return 'starting generation...';
      case 'generating':
        return 'generating image...';
      case 'saving results':
        return 'saving results...';
      case 'error':
        return 'error occurred';
      default:
        if (stage.includes('generating image')) {
          return stage.charAt(0).toUpperCase() + stage.slice(1) + '...';
        }
        return stage.charAt(0).toUpperCase() + stage.slice(1) + '...';
    }
  };

  // Handle escape key to close maximized view or QR code
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isMaximized) {
          setIsMaximized(false);
        } else if (showQRCode) {
          setShowQRCode(false);
        }
      }
    };

    if (isMaximized || showQRCode) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isMaximized, showQRCode]);

  const handleGenerate3D = async () => {
    if (!result?.generation_id || approvedImageIndex !== selectedImageIndex || threeDRequestInFlight.current) return;
    threeDRequestInFlight.current = true;
    setIsGenerating3D(true);
    setThreeDError('');
    try {
      const generated = await generate3DModel(result.generation_id, selectedImageIndex);
      setThreeDResult(generated);
    } catch (error: any) {
      const detail = error?.response?.data?.detail || 'InstantMesh generation failed. Check the GPU runtime and InstantMesh configuration (see README → Troubleshooting).';
      setThreeDError(detail);
    } finally {
      threeDRequestInFlight.current = false;
      setIsGenerating3D(false);
    }
  };

  // Show progress within placeholder during generation
  if (progress && result?.generation_id) {
    return (
      <div className="image-result progress">
        <div className="progress-preview-container">
          {progress.intermediate_image ? (
            <div className="progress-preview-with-image">
              <img 
                src={progress.intermediate_image}
                alt="Generation in progress"
                className="progress-preview-image"
              />
              <div className="progress-overlay-modern">
                <div className="progress-info-modern">
                  <div className="progress-stage-text">{getStageDisplay(progress.stage)}</div>
                  <div className="progress-step-text">
                    step {progress.current_step} of {progress.total_steps}
                  </div>
                </div>
                <div className="progress-bar-modern">
                  <div 
                    className="progress-bar-fill-modern"
                    style={{ width: `${progress.percentage}%` }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="progress-preview-placeholder">
              <div className="progress-spinner-modern"></div>
              <div className="progress-info-centered">
                <div className="progress-stage-text">{getStageDisplay(progress.stage)}</div>
                <div className="progress-step-text">
                  {progress.current_step > 0 ? (
                    `step ${progress.current_step} of ${progress.total_steps}`
                  ) : (
                    'preparing...'
                  )}
                </div>
              </div>
              <div className="progress-bar-modern">
                <div 
                  className="progress-bar-fill-modern"
                  style={{ width: `${progress.percentage}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
  
  // Empty state
  if (!result || (!progress && result.status === 'processing')) {
    return (
      <div className="result-empty-stack">
        <div className="image-result empty"><div className="placeholder"><p>{result?.status === 'processing' ? 'Connecting to the enhancement progress stream…' : 'Your enhanced sketch will appear here. Draw or upload an image to begin.'}</p></div></div>
        <div className="viewer-empty-state" aria-label="3D viewer waiting for an approved image">
          <div className="viewer-empty-grid" aria-hidden="true"><span /><i /></div>
          <div className="viewer-empty-copy"><span className="viewer-empty-icon">◇</span><strong>Your 3D workspace</strong><small>Generate and approve an enhanced image to build your model.</small></div>
          <span className="viewer-empty-controls">ORBIT&nbsp; · &nbsp;ZOOM&nbsp; · &nbsp;PAN</span>
        </div>
      </div>
    );
  }
  
  if (result?.status === 'failed') {
    return (
      <div className="image-result empty">
        <div className="placeholder">
          <p>{result.message || 'Image generation failed. Please try again.'}</p>
        </div>
      </div>
    );
  }

  // Completed state with generated images
  return (
    <>
      <div className="image-result completed">
        {imageUrls.length > 0 && (
          <div className="image-gallery">
            {/* Main Image Display */}
            <div className="main-image-container">
              <div className="main-image-wrapper">
                <img 
                  src={imageUrls[selectedImageIndex]}
                  alt="Generated from sketch" 
                  className="main-image"
                />
                
                {/* Result Controls - now inside main image wrapper */}
                <div className="result-controls">
                  <button 
                    className="control-button"
                    onClick={handleDownload}
                    title="Download Image"
                    aria-label="Download Image"
                  >
                    <Icon name="download" size={16} />
                    <span className="button-text">download</span>
                  </button>
                  
                  <button 
                    className="control-button"
                    onClick={handleShare}
                    title="Show QR Code"
                    aria-label="Show QR Code"
                  >
                    <Icon name="qr" size={16} />
                    <span className="button-text">scan to download</span>
                  </button>
                  
                  <button 
                    className="control-button"
                    onClick={handleMaximize}
                    title="View Full Size"
                    aria-label="View Full Size"
                  >
                    <Icon name="expand" size={16} />
                    <span className="button-text">view full size</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Thumbnail Gallery - only show if multiple images */}
            {imageUrls.length > 1 && (
              <div className="thumbnail-gallery">
                {imageUrls.map((imageUrl, index) => (
                  <button
                    key={index}
                    type="button"
                    className={`thumbnail-container ${selectedImageIndex === index ? 'selected' : ''}`}
                    onClick={() => handleThumbnailClick(index)}
                    aria-label={`Select enhanced image ${index + 1}`}
                    aria-pressed={selectedImageIndex === index}
                    disabled={isGenerating3D}
                  >
                    <img 
                      src={imageUrl}
                      alt={`Generated variation ${index + 1}`}
                      className="thumbnail-image"
                    />
                    <div className="thumbnail-overlay">
                      <span className="thumbnail-number">{index + 1}</span>
                    </div>
                    {result?.quality && (
                      <span className={`fidelity-badge ${result.quality.best_index === index ? 'is-best' : ''}`} title="Silhouette IoU against your sketch">
                        {result.quality.best_index === index ? '★ Best match · ' : ''}{Math.round((result.quality.scores[index] ?? 0) * 100)}%
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div className="poofit3d-model-actions" style={{ padding: '12px 0', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span>Selected preview: {selectedImageIndex + 1}{result?.quality ? ` · sketch fidelity ${Math.round((result.quality.scores[selectedImageIndex] ?? 0) * 100)}%` : ''}{result?.generation_seconds ? ` · generated in ${result.generation_seconds.toFixed(0)}s` : ''}</span>
              {approvedImageIndex !== selectedImageIndex ? (
                <button
                  className="control-button approve-image-button"
                  type="button"
                  disabled={isGenerating3D}
                  onClick={() => { setApprovedImageIndex(selectedImageIndex); setThreeDError(''); }}
                >
                  Approve this image
                </button>
              ) : (
                <><span className="approval-confirmation" role="status">✓ Image approved for 3D</span><button className="control-button change-image-button" type="button" onClick={() => { setApprovedImageIndex(null); setThreeDResult(null); setThreeDError(''); }} disabled={isGenerating3D}>Change selection</button><button className="control-button generate-model-button" type="button" onClick={handleGenerate3D} disabled={isGenerating3D}>{isGenerating3D ? <><span className="model-spinner" /> InstantMesh is reconstructing…</> : threeDError ? 'Try 3D generation again' : 'Generate 3D model'}</button></>
              )}
              {isGenerating3D && <span className="generation-status" role="status" aria-live="polite">Running InstantMesh on the configured GPU. This may take a few minutes.</span>}
              {threeDResult && <a className="control-button" href={threeDResult.model_url} download={threeDResult.filename}>download GLB</a>}
              {threeDResult && <span className="model-metadata">{threeDResult.vertices.toLocaleString()} vertices · {threeDResult.faces.toLocaleString()} faces · {threeDResult.device} · {threeDResult.engine}</span>}
              {threeDError && <span role="alert" style={{ color: '#b42318', fontSize: '12px' }}>{threeDError}</span>}
            </div>
            {threeDResult && <ThreeModelViewer src={threeDResult.model_url} />}
            {!threeDResult && <div className="viewer-empty-state post-approval-viewer" aria-label="3D viewer waiting for model generation"><div className="viewer-empty-grid" aria-hidden="true"><span /><i /></div><div className="viewer-empty-copy"><span className="viewer-empty-icon">◇</span><strong>{approvedImageIndex === selectedImageIndex ? 'Ready for reconstruction' : 'Your 3D workspace'}</strong><small>{approvedImageIndex === selectedImageIndex ? 'Your approved image is ready. Generate a model to explore it here.' : 'Approve your selected image, then generate a model to explore it here.'}</small></div><span className="viewer-empty-controls">ORBIT&nbsp; · &nbsp;ZOOM&nbsp; · &nbsp;PAN</span></div>}
          </div>
        )}
      </div>

      {/* QR Code Modal */}
      {showQRCode && qrCodeUrl && (
        <div className="qr-modal-overlay" onClick={handleCloseQRCode}>
          <div className="qr-modal-container" onClick={(e) => e.stopPropagation()}>
            <button 
              className="qr-modal-close"
              onClick={handleCloseQRCode}
              title="Close"
              aria-label="Close QR code"
            >
              <Icon name="close" size={20} />
            </button>
            <div className="qr-modal-content">
              <h3 className="qr-modal-title">Scan to download on your device</h3>
              <div className="qr-code-wrapper">
                <img 
                  src={qrCodeUrl}
                  alt="QR Code for sharing" 
                  className="qr-code-image"
                />
              </div>
              <p className="qr-modal-subtitle">
                scan this code with your phone to view and download the image
              </p>
            </div>
          </div>
        </div>
      )}

      {isMaximized && imageUrls.length > 0 && (
        <div className="image-modal-overlay" onClick={handleCloseMaximized}>
          <div className="image-modal-container">
            <button 
              className="image-modal-close"
              onClick={handleCloseMaximized}
              title="Close"
              aria-label="Close maximized view"
            >
              <Icon name="close" size={20} />
            </button>
            <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
              <img 
                src={imageUrls[selectedImageIndex]}
                alt="Generated from sketch - Maximized view" 
                className="maximized-image"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ImageResult;
