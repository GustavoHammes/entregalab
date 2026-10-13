import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>('input, textarea')?.focus();
    return () => dialog.close();
  }, []);
  return <dialog className="modal" aria-labelledby={headingId} ref={ref} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="modal-header"><h2 id={headingId}>{title}</h2><button type="button" className="icon-button" title="Fechar" aria-label="Fechar" onClick={onClose}><X size={18} /></button></header>
    {children}
  </dialog>;
}
