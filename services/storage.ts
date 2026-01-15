import { supabase } from './supabase';

export class StorageService {
  private bucketName = 'vox-media';
  
  /**
   * Upload audio file (base64) to Supabase Storage
   */
  async uploadAudio(userId: string, audioBase64: string, filename: string): Promise<string> {
    try {
      // Convert base64 to blob
      const audioBlob = this.base64ToBlob(audioBase64, 'audio/wav');
      
      const filePath = `${userId}/audio/${Date.now()}-${filename}.wav`;
      
      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .upload(filePath, audioBlob, {
          contentType: 'audio/wav',
          cacheControl: '3600',
          upsert: false,
        });
      
      if (error) throw error;
      
      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from(this.bucketName)
        .getPublicUrl(filePath);
      
      return publicUrl;
    } catch (error: any) {
      console.error('Upload audio error:', error);
      throw new Error('Failed to upload audio file');
    }
  }
  
  /**
   * Upload image to Supabase Storage
   */
  async uploadImage(userId: string, imageUrl: string, filename: string): Promise<string> {
    try {
      // If it's a base64 data URL
      if (imageUrl.startsWith('data:')) {
        const imageBlob = this.dataUrlToBlob(imageUrl);
        const filePath = `${userId}/images/${Date.now()}-${filename}.png`;
        
        const { data, error } = await supabase.storage
          .from(this.bucketName)
          .upload(filePath, imageBlob, {
            contentType: 'image/png',
            cacheControl: '3600',
            upsert: false,
          });
        
        if (error) throw error;
        
        const { data: { publicUrl } } = supabase.storage
          .from(this.bucketName)
          .getPublicUrl(filePath);
        
        return publicUrl;
      }
      
      // If it's already a URL, return as-is
      return imageUrl;
    } catch (error: any) {
      console.error('Upload image error:', error);
      throw new Error('Failed to upload image');
    }
  }
  
  /**
   * Delete a file from storage
   */
  async deleteFile(filePath: string): Promise<void> {
    try {
      // Extract just the path part (remove bucket URL if present)
      const path = filePath.includes(this.bucketName) 
        ? filePath.split(this.bucketName + '/')[1] 
        : filePath;
      
      const { error } = await supabase.storage
        .from(this.bucketName)
        .remove([path]);
      
      if (error) throw error;
    } catch (error: any) {
      console.error('Delete file error:', error);
      // Don't throw - file deletion failures shouldn't break the app
    }
  }
  
  /**
   * Get signed URL for private files (if needed in the future)
   */
  async getSignedUrl(filePath: string, expiresIn: number = 3600): Promise<string> {
    try {
      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .createSignedUrl(filePath, expiresIn);
      
      if (error) throw error;
      return data.signedUrl;
    } catch (error: any) {
      console.error('Get signed URL error:', error);
      throw new Error('Failed to generate signed URL');
    }
  }
  
  // ==================== HELPER METHODS ====================
  
  /**
   * Convert base64 string to Blob
   */
  private base64ToBlob(base64: string, mimeType: string): Blob {
    const byteCharacters = atob(base64.replace(/[\n\r\t\s]/g, ''));
    const byteArrays = [];
    
    for (let i = 0; i < byteCharacters.length; i++) {
      byteArrays.push(byteCharacters.charCodeAt(i));
    }
    
    return new Blob([new Uint8Array(byteArrays)], { type: mimeType });
  }
  
  /**
   * Convert data URL to Blob
   */
  private dataUrlToBlob(dataUrl: string): Blob {
    const [header, base64] = dataUrl.split(',');
    const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
    return this.base64ToBlob(base64, mimeType);
  }
}

// Export singleton instance
export const storage = new StorageService();
