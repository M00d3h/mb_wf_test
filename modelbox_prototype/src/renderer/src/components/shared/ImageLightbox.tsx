import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface Props {
  src: string
  name: string
  onClose: () => void
}

export function ImageLightbox({ src, name, onClose }: Props): JSX.Element {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={name}
          className="max-w-full max-h-[90vh] rounded-lg object-contain shadow-2xl"
        />
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 bg-zinc-800 border border-zinc-600 rounded-full p-1 text-zinc-300 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <p className="absolute -bottom-7 inset-x-0 text-center text-xs text-zinc-500 truncate">
          {name}
        </p>
      </div>
    </div>,
    document.body
  )
}
