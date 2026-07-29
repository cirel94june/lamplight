import { useCallback, useRef, useState } from "react";

const ACCEPT = ".png,.jpg,.jpeg,.webp";
const MAX_DIMENSION = 4096;
const MIN_DIMENSION = 1;

async function validateDimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  bitmap.close();
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    throw new Error("图片尺寸无效");
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error(`图片尺寸过大（最大 ${MAX_DIMENSION}×${MAX_DIMENSION}）`);
  }
  return { width, height };
}

interface Props {
  label: string;
  currentUrl?: string;
  onUpload: (file: File) => Promise<string>;
  onDelete?: () => Promise<void>;
}

export function AssetUploader({ label, currentUrl, onUpload, onDelete }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setError(null);
      try {
        await validateDimensions(file);
      } catch (err: any) {
        setError(err.message ?? "图片无法解码");
        if (inputRef.current) inputRef.current.value = "";
        return;
      }

      setPreview(URL.createObjectURL(file));
      setUploading(true);
      try {
        await onUpload(file);
      } catch (err: any) {
        setError(err.message ?? "上传失败");
        setPreview(null);
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [onUpload],
  );

  const handleDelete = useCallback(async () => {
    if (!onDelete) return;
    setError(null);
    try {
      await onDelete();
      setPreview(null);
    } catch (err: any) {
      setError(err.message ?? "删除失败");
    }
  }, [onDelete]);

  const displayUrl = preview ?? currentUrl;

  return (
    <div className="asset-uploader">
      <span className="asset-label">{label}</span>
      <div className="asset-preview-area">
        {displayUrl ? (
          <img src={displayUrl} alt={label} className="asset-preview-img" />
        ) : (
          <span className="asset-placeholder">无</span>
        )}
      </div>
      <div className="asset-actions">
        <button
          className="asset-upload-btn"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "上传中…" : "上传"}
        </button>
        {currentUrl && onDelete && (
          <button className="asset-delete-btn" onClick={handleDelete}>
            删除
          </button>
        )}
      </div>
      {error && <span className="asset-error">{error}</span>}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={handleFile}
        hidden
      />
    </div>
  );
}
