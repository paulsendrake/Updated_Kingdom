import { useState } from 'react';
import api from '../api/client.js';
import { toast } from './Toast.jsx';
import { parseApiError } from '../utils/apiError.js';

// A small "Draft this for me" link next to one text field — a one-shot
// generation call (server/src/routes/ai.js's POST /generate-field), not the
// full chat assistant. Reusable anywhere a free-text field could use a
// starting draft: pass what the field is for, any extra context worth
// grounding the model in, and what's already typed (if anything).
export default function AiDraftButton({ fieldLabel, context, existingText, onGenerated, className }) {
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const { data } = await api.post('/ai/generate-field', { fieldLabel, context, existingText });
      onGenerated?.(data.text || '');
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={className || 'btn btn-link btn-sm p-0 text-decoration-none'}
      onClick={generate}
      disabled={busy}
    >
      {busy ? (
        <><span className="spinner-border spinner-border-sm me-1" style={{ width: 12, height: 12 }}></span>Drafting…</>
      ) : (
        <><iconify-icon icon="solar:stars-line-duotone" class="me-1"></iconify-icon>Draft this for me</>
      )}
    </button>
  );
}
