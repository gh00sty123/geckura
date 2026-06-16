"use client";

import { useState, useRef } from "react";
import { FiUploadCloud, FiX, FiImage } from "react-icons/fi";
import toast from "react-hot-toast";

interface ImageUploadProps {
  label: string;
  value: string;
  onChange: (url: string) => void;
  className?: string;
}

export function ImageUpload({ label, value, onChange, className = "" }: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

    if (!cloudName || !uploadPreset) {
      toast.error("Cloudinary credentials are not configured in .env");
      return;
    }

    try {
      setIsUploading(true);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", uploadPreset);

      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Failed to upload image");
      }

      const data = await res.json();
      onChange(data.secure_url);
      toast.success("Image uploaded successfully!");
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload image");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <label className="block text-xs text-gray-500 uppercase">{label}</label>
      
      {value ? (
        <div className="relative rounded-lg overflow-hidden border border-gray-700 bg-gray-900 group">
          <img src={value} alt="Uploaded" className="w-full h-32 object-cover" />
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
            <button
              type="button"
              onClick={() => onChange("")}
              className="bg-red-500/20 text-red-400 border border-red-500/50 p-2 rounded-full hover:bg-red-500/40 transition-colors"
              title="Remove Image"
            >
              <FiX className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : (
        <div 
          onClick={() => fileInputRef.current?.click()}
          className={`
            border-2 border-dashed border-gray-700 rounded-lg p-6 
            flex flex-col items-center justify-center gap-3
            cursor-pointer hover:border-purple-500 hover:bg-purple-500/5 transition-colors
            ${isUploading ? "opacity-50 pointer-events-none" : ""}
          `}
        >
          {isUploading ? (
            <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          ) : (
            <FiUploadCloud className="w-8 h-8 text-gray-500" />
          )}
          <div className="text-sm text-gray-400 text-center">
            {isUploading ? (
              <span>Uploading...</span>
            ) : (
              <span>
                <span className="text-purple-400 font-semibold">Click to upload</span> or drag and drop
              </span>
            )}
          </div>
        </div>
      )}
      
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleUpload}
        accept="image/*"
        className="hidden"
      />
      
      {/* Fallback to manual URL input just in case */}
      <div className="flex gap-2 items-center mt-2">
        <FiImage className="text-gray-500 w-4 h-4 shrink-0" />
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Or paste an image URL..."
          className="w-full bg-transparent border-none text-xs text-gray-400 focus:outline-none focus:text-white"
        />
      </div>
    </div>
  );
}
