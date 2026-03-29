import { useCallback, useState } from 'react';

export default function MeshUploader({ onFileSelected, disabled }) {
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState(null);

  const handleFile = useCallback((file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'obj' && ext !== 'stl') {
      alert('Unsupported file type. Use .obj or .stl');
      return;
    }
    setFileName(file.name);
    onFileSelected(file);
  }, [onFileSelected]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`
        border border-dashed rounded px-4 py-6 text-center cursor-pointer
        transition-colors text-sm
        ${dragOver ? 'border-amber-400 bg-amber-400/5' : 'border-zinc-700 bg-zinc-900/50'}
        ${disabled ? 'opacity-50 pointer-events-none' : 'hover:border-zinc-500'}
      `}
    >
      <label className="cursor-pointer block">
        <input
          type="file"
          accept=".obj,.stl"
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
          disabled={disabled}
        />
        {fileName ? (
          <div>
            <div className="text-amber-400 mb-1">{fileName}</div>
            <div className="text-zinc-500 text-xs">click or drop to replace</div>
          </div>
        ) : (
          <div>
            <div className="text-zinc-400 mb-1">drop .obj / .stl mesh here</div>
            <div className="text-zinc-600 text-xs">or click to browse</div>
          </div>
        )}
      </label>
    </div>
  );
}
