import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ApiError } from '../../shared/services/apiClient';
import type { Theme } from '../../shared/types/content';
import { fetchThemes } from '../content/api';
import { deleteMedia, fetchMedia, updateMedia, uploadMedia } from './api';
import type { MediaAsset, MediaKind } from './api';
import '../content/Content.css';
import './Media.css';

const KINDS: { value: MediaKind; label: string }[] = [
  { value: 'featured', label: 'Featured' },
  { value: 'inline', label: 'Inline' },
  { value: 'diagram', label: 'Diagram' },
  { value: 'screenshot', label: 'Screenshot' },
  { value: 'other', label: 'Other' },
];

/**
 * The media library.
 *
 * Images for ARTICLES, as distinct from product images — a product image
 * belongs to its product and reaches an article automatically, while an image
 * here is loose and has to be findable.
 *
 * Which is why the upload form asks for a thematic area, a description and
 * tags rather than just a file: Cynth cannot see what a photograph contains,
 * so those fields are the only thing matching can work from. The form says so
 * rather than letting a user discover it later.
 */
export function MediaLibrary() {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [themeFilter, setThemeFilter] = useState<string>('');
  const [search, setSearch] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', description: '', altText: '', tags: '', credit: '', themeId: '', kind: 'featured' as MediaKind });
  const fileInput = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});

  function load() {
    setIsLoading(true);
    Promise.all([fetchMedia(), fetchThemes()])
      .then(([media, loadedThemes]) => {
        setAssets(media);
        setThemes(loadedThemes);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load the media library.'))
      .finally(() => setIsLoading(false));
  }

  useEffect(load, []);

  const visible = useMemo(() => {
    return assets.filter((asset) => {
      if (themeFilter === 'none' && asset.themeId !== null) return false;
      if (themeFilter && themeFilter !== 'none' && String(asset.themeId) !== themeFilter) return false;
      if (!search.trim()) return true;
      const haystack = [asset.title, asset.description, asset.altText, asset.tags.join(' ')].join(' ').toLowerCase();
      return haystack.includes(search.trim().toLowerCase());
    });
  }, [assets, themeFilter, search]);

  /** Grouped by area, because that is how a library of forty stops being a pile of forty. */
  const byTheme = useMemo(() => {
    const groups = new Map<string, MediaAsset[]>();
    for (const asset of visible) {
      const key = asset.themeName ?? 'No thematic area';
      groups.set(key, [...(groups.get(key) ?? []), asset]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  function pickFile(selected: File | null) {
    setFile(selected);
    setPreview(selected ? URL.createObjectURL(selected) : null);
    if (selected && !form.title.trim()) {
      setForm((f) => ({ ...f, title: selected.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') }));
    }
  }

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (!file) return setError('Choose an image first.');

    setBusy('upload');
    try {
      await uploadMedia(file, {
        title: form.title.trim() || file.name,
        description: form.description.trim() || undefined,
        altText: form.altText.trim() || undefined,
        kind: form.kind,
        tags: form.tags.trim() || undefined,
        credit: form.credit.trim() || undefined,
        themeId: form.themeId ? Number(form.themeId) : null,
      } as never);

      setFile(null);
      setPreview(null);
      setForm({ title: '', description: '', altText: '', tags: '', credit: '', themeId: form.themeId, kind: form.kind });
      if (fileInput.current) fileInput.current.value = '';
      load();
      setNotice('Image uploaded.');
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not upload that image.');
      setNotice(null);
    } finally {
      setBusy(null);
    }
  }

  function startEdit(asset: MediaAsset) {
    setEditing(asset.id);
    setEditForm({
      title: asset.title,
      description: asset.description ?? '',
      altText: asset.altText ?? '',
      tags: asset.tags.join(', '),
      credit: asset.credit ?? '',
      themeId: asset.themeId ? String(asset.themeId) : '',
      kind: asset.kind,
    });
  }

  async function saveEdit(id: number) {
    setBusy(`save-${id}`);
    try {
      await updateMedia(id, { ...editForm, themeId: editForm.themeId || null });
      setEditing(null);
      load();
      setNotice('Saved.');
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not save that image.');
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(asset: MediaAsset) {
    const warning = asset.usageCount
      ? `"${asset.title}" is used in ${asset.usageCount} article(s). Delete it anyway? The file is removed from disk.`
      : `Delete "${asset.title}"? The file is removed from disk.`;
    if (!window.confirm(warning)) return;

    setBusy(`delete-${asset.id}`);
    try {
      await deleteMedia(asset.id);
      load();
      setNotice(`"${asset.title}" was deleted.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not delete that image.');
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) {
    return (
      <div className="page">
        <p>Loading media library…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Media Library"
        description="Images for articles. Product images live with their product — these are the ones an article has to find."
      />

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="form-notice">{notice}</p>}

      <section className="content-section">
        <h2>Upload</h2>
        <p className="content-hint">
          Cynth cannot see what an image contains. The thematic area, description and tags are the only things it can
          match on when choosing an image for an article — an image with none of them will only ever be matched on its
          area.
        </p>

        <form className="content-form" onSubmit={handleUpload}>
          <label>
            Image file
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </label>

          {preview && <img className="media-upload__preview" src={preview} alt="Selected image preview" />}

          <label>
            Title
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </label>

          <label>
            Thematic Area
            <select value={form.themeId} onChange={(e) => setForm((f) => ({ ...f, themeId: e.target.value }))}>
              <option value="">No thematic area</option>
              {themes.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Kind
            <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as MediaKind }))}>
              {KINDS.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            What the image shows
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="e.g. A standing desk with a monitor light bar, lit from above"
            />
          </label>

          <label>
            Alt text
            <input
              value={form.altText}
              onChange={(e) => setForm((f) => ({ ...f, altText: e.target.value }))}
              placeholder="Carried through to WordPress for accessibility"
            />
          </label>

          <label>
            Tags
            <input
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              placeholder="Comma separated, e.g. desk, lighting, ergonomics"
            />
          </label>

          <label>
            Credit
            <input value={form.credit} onChange={(e) => setForm((f) => ({ ...f, credit: e.target.value }))} />
          </label>

          <div className="content-form__actions">
            <button type="submit" className="button button--primary" disabled={!file || busy === 'upload'}>
              {busy === 'upload' ? 'Uploading…' : 'Upload Image'}
            </button>
          </div>
        </form>
      </section>

      <section className="content-section">
        <div className="content-section__head">
          <h2>Library ({assets.length})</h2>
        </div>

        <div className="media-filters">
          <label>
            Thematic Area
            <select value={themeFilter} onChange={(e) => setThemeFilter(e.target.value)}>
              <option value="">All areas</option>
              <option value="none">No thematic area</option>
              {themes.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Search
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title, description or tag" />
          </label>
        </div>

        {visible.length === 0 ? (
          <p className="article-list__empty">
            {assets.length === 0 ? 'No images yet. Upload one above.' : 'No images match this filter.'}
          </p>
        ) : (
          byTheme.map(([themeName, group]) => (
            <div key={themeName} className="media-group">
              <h3 className="media-group__title">
                {themeName} <span className="media-group__count">({group.length})</span>
              </h3>

              <ul className="media-grid">
                {group.map((asset) => (
                  <li key={asset.id} className={`media-card${asset.isActive ? '' : ' is-inactive'}`}>
                    <img className="media-card__image" src={asset.url} alt={asset.altText ?? ''} loading="lazy" />

                    {editing === asset.id ? (
                      <div className="media-card__body">
                        <input
                          value={editForm.title}
                          onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                          placeholder="Title"
                        />
                        <select
                          value={editForm.themeId}
                          onChange={(e) => setEditForm((f) => ({ ...f, themeId: e.target.value }))}
                        >
                          <option value="">No thematic area</option>
                          {themes.map((theme) => (
                            <option key={theme.id} value={theme.id}>
                              {theme.name}
                            </option>
                          ))}
                        </select>
                        <select value={editForm.kind} onChange={(e) => setEditForm((f) => ({ ...f, kind: e.target.value }))}>
                          {KINDS.map((kind) => (
                            <option key={kind.value} value={kind.value}>
                              {kind.label}
                            </option>
                          ))}
                        </select>
                        <textarea
                          rows={2}
                          value={editForm.description}
                          onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                          placeholder="What the image shows"
                        />
                        <input
                          value={editForm.altText}
                          onChange={(e) => setEditForm((f) => ({ ...f, altText: e.target.value }))}
                          placeholder="Alt text"
                        />
                        <input
                          value={editForm.tags}
                          onChange={(e) => setEditForm((f) => ({ ...f, tags: e.target.value }))}
                          placeholder="Tags"
                        />
                        <div className="media-card__actions">
                          <button type="button" className="button button--primary" disabled={busy === `save-${asset.id}`} onClick={() => saveEdit(asset.id)}>
                            Save
                          </button>
                          <button type="button" className="button" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="media-card__body">
                        <strong className="media-card__title">{asset.title}</strong>
                        <div className="media-card__meta">
                          {KINDS.find((k) => k.value === asset.kind)?.label ?? asset.kind}
                          {asset.usageCount > 0 && ` · used in ${asset.usageCount} article(s)`}
                        </div>
                        {asset.description ? (
                          <p className="media-card__desc">{asset.description}</p>
                        ) : (
                          <p className="media-card__warn">
                            No description — this image can only be matched on its area.
                          </p>
                        )}
                        {asset.tags.length > 0 && (
                          <div className="media-card__tags">
                            {asset.tags.map((tag) => (
                              <span key={tag} className="media-tag">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="media-card__actions">
                          <button type="button" className="button" onClick={() => startEdit(asset)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="button button--danger"
                            disabled={busy === `delete-${asset.id}`}
                            onClick={() => handleDelete(asset)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
