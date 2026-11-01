import axios from 'axios';
import { Style, Model, GenerationResult } from '../types';

// Use relative path - proxy will handle routing
// Set REACT_APP_API_URL to the backend origin plus /api for deployments
// where the React app and FastAPI server do not share the same origin.
const configuredApiUrl = process.env.REACT_APP_API_URL?.trim();
const trimmedApiUrl = configuredApiUrl?.endsWith('/')
  ? configuredApiUrl.slice(0, -1)
  : configuredApiUrl;
const API_URL = trimmedApiUrl
  ? (trimmedApiUrl.endsWith('/api') ? trimmedApiUrl : `${trimmedApiUrl}/api`)
  : '/api';

export const apiUrl = (path: string): string => {
  const normalizedPath = path.startsWith('/api/')
    ? path.slice(4)
    : path.startsWith('/api')
      ? '/'
      : path;
  return `${API_URL}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
};

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const fetchStyles = async (): Promise<Style[]> => {
  try {
    const response = await api.get('/styles');
    return response.data;
  } catch (error) {
    console.error('Error fetching styles:', error);
    throw error;
  }
};

export const fetchModels = async (): Promise<Model[]> => {
  try {
    const response = await api.get('/models');
    return response.data;
  } catch (error) {
    console.error('Error fetching models:', error);
    throw error;
  }
};

export const generateImage = async (
  sketchFile: File,
  styleId: string,
  modelId: string,
  description?: string
): Promise<GenerationResult> => {
  try {
    const formData = new FormData();
    formData.append('sketch_file', sketchFile);
    formData.append('style_id', styleId);
    
    if (modelId) {
      formData.append('model_id', modelId);
    }
    
    if (description) {
      formData.append('description', description);
    }

    const response = await api.post('/generate', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return response.data;
  } catch (error) {
    console.error('Error generating image:', error);
    throw error;
  }
};

export const checkGenerationStatus = async (generationId: string): Promise<GenerationResult> => {
  try {
    const response = await api.get(`/status/${generationId}`);
    return response.data;
  } catch (error) {
    console.error('Error checking generation status:', error);
    throw error;
  }
};

export interface ThreeDResult {
  status: string;
  model_url: string;
  filename: string;
  vertices: number;
  faces: number;
  device: string;
  engine: string;
  textured: boolean;
  texture_materials: number;
  elapsed_seconds: number;
}

export const generate3DModel = async (generationId: string, imageIndex: number): Promise<ThreeDResult> => {
  const formData = new FormData();
  formData.append('generation_id', generationId);
  formData.append('image_index', String(imageIndex));
  const response = await api.post('/3d/generate', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 0,
  });
  return { ...response.data, model_url: apiUrl(response.data.model_url) };
};
