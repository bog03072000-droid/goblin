import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import type { Os } from '@shared/schemas/fingerprint';
import { callApi } from '../services/api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useTranslation } from '../i18n';

interface BulkImportRow {
  row: number;
  name: string;
  os?: Os;
  proxyLabel?: string;
  groupName?: string;
  tags: string[];
  error?: string;
}

interface BulkImportParseResult {
  fileName: string;
  rows: BulkImportRow[];
}

interface BulkImportCommitResult {
  created: Array<{ id: string; name: string }>;
  errors: Array<{ row: number; message: string }>;
}

type Step = 'upload' | 'preview' | 'result';

/**
 * "Bulk import profiles from CSV/XLSX" wizard — upload, preview/validate,
 * confirm, create. Unlike every other import path in this app (JSON/zip
 * native export, GoLogin export), which create profiles in the same
 * round-trip as picking the file, this one has a real preview step: a
 * spreadsheet's proxy/group columns are free text a person typed, not a
 * validated id, so showing exactly what will happen (and what's already
 * broken) before anything is created is the whole point — see
 * bulkCsvImportService.ts's own top comment for the same reasoning from the
 * main-process side.
 */
export function BulkImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }): JSX.Element {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<BulkImportRow[]>([]);
  const [result, setResult] = useState<BulkImportCommitResult | null>(null);
  const parseAction = useAsyncAction();
  const commitAction = useAsyncAction();

  const validRows = rows.filter((r) => !r.error);
  const invalidRows = rows.filter((r) => r.error);

  async function chooseFile(): Promise<void> {
    await parseAction.run(async () => {
      const parsed = await callApi<'profiles:bulkImportParse', BulkImportParseResult | null>(
        'profiles:bulkImportParse',
        {},
      );
      if (!parsed) return; // user cancelled the native file dialog
      setFileName(parsed.fileName);
      setRows(parsed.rows);
      setStep('preview');
    });
  }

  async function confirmImport(): Promise<void> {
    await commitAction.run(async () => {
      const commitResult = await callApi<'profiles:bulkImportCommit', BulkImportCommitResult>(
        'profiles:bulkImportCommit',
        { rows },
      );
      setResult(commitResult);
      setStep('result');
      if (commitResult.created.length > 0) onImported();
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel modal-panel-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-tabs-header">
          <strong className="modal-tabs-title">{t('bulkImport.title')}</strong>
          <div className="flex-1" />
          <button className="btn btn-ghost btn-sm modal-close-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
        <div className="modal-body-scroll">
          {parseAction.error && <div className="banner banner-error">{parseAction.error}</div>}
          {commitAction.error && <div className="banner banner-error">{commitAction.error}</div>}

          {step === 'upload' && (
            <div className="bulk-import-upload">
              <p className="text-dim text-sm">{t('bulkImport.upload.hint')}</p>
              <p className="text-dim text-sm">{t('bulkImport.upload.columns')}</p>
              <button className="btn btn-primary" onClick={() => void chooseFile()} disabled={parseAction.pending}>
                <FileSpreadsheet size={14} strokeWidth={2.25} />
                {parseAction.pending ? t('common.loading') : t('bulkImport.upload.choose')}
              </button>
            </div>
          )}

          {step === 'preview' && (
            <div>
              <p className="text-dim text-sm">
                {t('bulkImport.preview.summary', { fileName, valid: validRows.length, invalid: invalidRows.length })}
              </p>
              <div className="table-scroll-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('bulkImport.col.row')}</th>
                      <th>{t('bulkImport.col.name')}</th>
                      <th>{t('bulkImport.col.os')}</th>
                      <th>{t('bulkImport.col.proxy')}</th>
                      <th>{t('bulkImport.col.group')}</th>
                      <th>{t('bulkImport.col.tags')}</th>
                      <th>{t('bulkImport.col.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.row} className={row.error ? 'row-invalid' : undefined}>
                        <td>{row.row}</td>
                        <td>{row.name || '—'}</td>
                        <td>{row.os ?? '—'}</td>
                        <td>{row.proxyLabel ?? '—'}</td>
                        <td>{row.groupName ?? '—'}</td>
                        <td>{row.tags.join(', ') || '—'}</td>
                        <td className={row.error ? 'status-MISMATCH' : 'status-PASS'}>
                          {row.error ?? t('bulkImport.status.ok')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="modal-footer">
                <button className="btn btn-ghost" onClick={() => setStep('upload')}>
                  {t('bulkImport.chooseAnother')}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => void confirmImport()}
                  disabled={validRows.length === 0 || commitAction.pending}
                >
                  {commitAction.pending
                    ? t('common.loading')
                    : t('bulkImport.confirmCreate', { count: validRows.length })}
                </button>
              </div>
            </div>
          )}

          {step === 'result' && result && (
            <div>
              <div className="banner banner-success">
                {t('bulkImport.result.created', { count: result.created.length })}
              </div>
              {result.errors.length > 0 && (
                <div className="banner banner-warn">
                  {t('bulkImport.result.skipped', { count: result.errors.length })}
                  <ul className="bulk-failure-list">
                    {result.errors.map((e) => (
                      <li key={e.row}>
                        {t('bulkImport.col.row')} {e.row}: {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="modal-footer">
                <button className="btn btn-primary" onClick={onClose}>
                  {t('common.close')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
