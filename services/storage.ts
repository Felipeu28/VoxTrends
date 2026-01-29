import { supabase } from './supabase';

export class StorageService {
  private bucketName = 'vox-media';

  /**
   * Convert PCM base64 audio to proper WAV format with headers
   */
  private createWavFile(base64Audio: string, sampleRate: number = 24000, numChannels: number = 1): Blob {
    // Decode base64 to raw PCM data
    const binaryString = atob(base64Audio.replace(/[\n\r\t\s]/g, ''));
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Calculate sizes
    const dataSize = bytes.length;
    const fileSize = 44 + dataSize; // 44 bytes for WAV header

    // Create WAV file with proper headers
    const wavBuffer = new ArrayBuffer(fileSize);
    const view = new DataView(wavBuffer);

    // Write WAV header
    // "RIFF" chunk descriptor
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, fileSize - 8, true); // File size - 8
    view.setUint32(8, 0x57415645, false); // "WAVE"

    // "fmt " sub-chunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
    view.setUint16(22, numChannels, true); // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, sampleRate * numChannels * 2, true); // ByteRate
    view.setUint16(32, numChannels * 2, true); // BlockAlign
    view.setUint16(34, 16, true); // BitsPerSample

    // "data" sub-chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataSize, true); // Subchunk2Size

    // Write PCM data
    const pcmData = new Uint8Array(wavBuffer, 44);
    pcmData.set(bytes);

    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  /**
   * Upload audio file (base64) to Supabase Storage
   */
  async uploadAudio(userId: string, audioBase64: string, filename: string): Promise<string> {
    try {
      console.log('📤 Starting audio upload...', { userId, filename });

      // Strip data URL prefix if present (data:audio/wav;base64,...)
      let rawBase64 = audioBase64;
      if (audioBase64.includes(',')) {
        rawBase64 = audioBase64.split(',')[1];
        console.log('✅ Stripped data URL prefix');
      }

      // Backend already returns complete WAV file - just decode it
      const binaryString = atob(rawBase64.replace(/[\n\r\t\s]/g, ''));
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const wavBlob = new Blob([bytes], { type: 'audio/wav' });
      console.log('✅ WAV blob created:', { size: wavBlob.size, type: wavBlob.type });

      const filePath = `${userId}/audio/${Date.now()}-${filename}.wav`;

      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .upload(filePath, wavBlob, {
          contentType: 'audio/wav',
          cacheControl: '3600',
          upsert: false,
        });

      if (error) {
        console.error('❌ Audio upload error:', error);
        throw error;
      }

      console.log('✅ Audio uploaded successfully:', data);

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from(this.bucketName)
        .getPublicUrl(filePath);

      console.log('🔗 Public URL generated:', publicUrl);
      return publicUrl;
    } catch (error: any) {
      console.error('💥 Upload audio failed:', error);
      throw new Error(`Failed to upload audio: ${error.message}`);
    }
  }

  /**
   * Upload image to Supabase Storage
   */
  async uploadImage(userId: string, imageUrl: string, filename: string): Promise<string> {
    try {
      console.log('📤 Starting image upload...', { userId, filename });

      // If it's a base64 data URL
      if (imageUrl.startsWith('data:')) {
        const imageBlob = this.dataUrlToBlob(imageUrl);
        console.log('✅ Image blob created:', { size: imageBlob.size, type: imageBlob.type });

        const filePath = `${userId}/images/${Date.now()}-${filename}.png`;

        const { data, error } = await supabase.storage
          .from(this.bucketName)
          .upload(filePath, imageBlob, {
            contentType: 'image/png',
            cacheControl: '3600',
            upsert: false,
          });

        if (error) {
          console.error('❌ Image upload error:', error);
          throw error;
        }

        console.log('✅ Image uploaded successfully:', data);

        const { data: { publicUrl } } = supabase.storage
          .from(this.bucketName)
          .getPublicUrl(filePath);

        console.log('🔗 Public URL generated:', publicUrl);
        return publicUrl;
      }

      // If it's already a URL, return as-is
      console.log('ℹ️ Image is already a URL:', imageUrl);
      return imageUrl;
    } catch (error: any) {
      console.error('💥 Upload image failed:', error);
      throw new Error(`Failed to upload image: ${error.message}`);
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
      console.log('✅ File deleted:', path);
    } catch (error: any) {
      console.error('❌ Delete file error:', error);
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
