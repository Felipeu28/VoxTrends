import { supabase } from './supabase';

export class StorageService {
  private bucketName = 'vox-media';
  
  async uploadAudio(userId: string, audioBase64: string, filename: string): Promise<string> {
    // Convert base64 to blob
    const audioBlob = this.base64ToBlob(audioBase64, 'audio/wav');
    
    const filePath = `${userId}/audio/${Date.now()}-${filename}.wav`;
    
    const { data, error } = await supabase.storage
      .from(this.bucketName)
      .upload(filePath, audioBlob, {
        contentType: 'audio/wav',
        cacheControl: '3600',
      });
    
    if (error) throw error;
    
    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from(this.bucketName)
      .getPublicUrl(filePath);
    
    return publicUrl;
  }
  
  async uploadImage(userId: string, imageUrl: string, filename: string): Promise<string> {
    // If it's a base64 data URL
    if (imageUrl.startsWith('data:')) {
      const imageBlob = this.dataUrlToBlob(imageUrl);
      const filePath = `${userId}/images/${Date.now()}-${filename}.png`;
      
      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .upload(filePath, imageBlob, {
          contentType: 'image/png',
          cacheControl: '3600',
        });
      
      if (error) throw error;
      
      const { data: { publicUrl } } = supabase.storage
        .from(this.bucketName)
        .getPublicUrl(filePath);
      
      return publicUrl;
    }
    
    // If it's already a URL, return as-is
    return imageUrl;
  }
  
  async deleteFile(filePath: string): Promise<void> {
    const { error } = await supabase.storage
      .from(this.bucketName)
      .remove([filePath]);
    
    if (error) throw error;
  }
  
  private base64ToBlob(base64: string, mimeType: string): Blob {
    const byteCharacters = atob(base64);
    const byteArrays = [];
    
    for (let i = 0; i < byteCharacters.length; i++) {
      byteArrays.push(byteCharacters.charCodeAt(i));
    }
    
    return new Blob([new Uint8Array(byteArrays)], { type: mimeType });
  }
  
  private dataUrlToBlob(dataUrl: string): Blob {
    const [header, base64] = dataUrl.split(',');
    const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
    return this.base64ToBlob(base64, mimeType);
  }
}

export const storage = new StorageService();
