import { useCallback, useRef, useState } from "react";

const ACCEPT = ".png,.jpg,.jpeg,.webp";

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
