import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import {
  archiveKnowledgeArticle,
  createKnowledgeArticle,
  downloadKnowledgeAttachment,
  getKnowledgeArticle,
  getKnowledgeArticles,
  getKnowledgeBootstrap,
  updateKnowledgeArticle,
} from '../../api/knowledge';

const emptyForm = {
  spaceId: '',
  categoryId: '',
  title: '',
  summary: '',
  content: '',
  articleType: 'article',
  status: 'published',
  moduleKey: '',
  tags: '',
  allowAi: true,
};

function tagsText(tags) {
  return Array.isArray(tags) ? tags.join(', ') : '';
}

function toPayload(form) {
  return {
    ...form,
    spaceId: Number(form.spaceId),
    categoryId: form.categoryId ? Number(form.categoryId) : null,
    tags: String(form.tags || '').split(',').map(item => item.trim()).filter(Boolean),
    allowAi: Boolean(form.allowAi),
  };
}

function statusLabel(status) {
  return { published: '已发布', draft: '草稿', archived: '已归档' }[status] || status || '草稿';
}

export default function KnowledgePage() {
  const { user } = useOutletContext() || {};
  const [spaces, setSpaces] = useState([]);
  const [categories, setCategories] = useState([]);
  const [spaceId, setSpaceId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [query, setQuery] = useState('');
  const [articles, setArticles] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [canManage, setCanManage] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [statusText, setStatusText] = useState('正在读取知识库...');
  const isAdmin = user?.role === 'admin';
  const mayManage = isAdmin || canManage;

  const visibleCategories = useMemo(
    () => categories.filter(item => !spaceId || String(item.spaceId) === String(spaceId)),
    [categories, spaceId]
  );

  const formCategories = useMemo(
    () => categories.filter(item => !form.spaceId || String(item.spaceId) === String(form.spaceId)),
    [categories, form.spaceId]
  );

  const loadBootstrap = async () => {
    const data = await getKnowledgeBootstrap();
    setSpaces(data.spaces || []);
    setCategories(data.categories || []);
    setCanManage(Boolean(data.canManage));
    if (!spaceId && data.spaces?.[0]) setSpaceId(String(data.spaces[0].id));
  };

  const loadArticles = async (preferredId = null) => {
    setStatusText('正在读取知识库...');
    const data = await getKnowledgeArticles({ q: query, spaceId, categoryId });
    const items = data.items || [];
    setArticles(items);
    const nextId = preferredId && items.some(item => item.id === preferredId)
      ? preferredId
      : selectedId && items.some(item => item.id === selectedId)
        ? selectedId
        : items[0]?.id;
    setSelectedId(nextId || null);
    if (!nextId) setSelected(null);
    setStatusText(`共 ${items.length} 条知识内容`);
  };

  const loadArticle = async (id) => {
    if (!id) return;
    const data = await getKnowledgeArticle(id);
    setSelected(data);
  };

  useEffect(() => {
    loadBootstrap().catch(err => setStatusText(err.message || '知识库初始化失败'));
  }, []);

  useEffect(() => {
    if (spaces.length) loadArticles().catch(err => setStatusText(err.message || '知识库加载失败'));
  }, [spaces.length, spaceId, categoryId]);

  useEffect(() => {
    if (selectedId) loadArticle(selectedId).catch(err => setStatusText(err.message || '文章加载失败'));
  }, [selectedId]);

  const startCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm, spaceId: spaceId || spaces[0]?.id || '' });
    setEditing(true);
  };

  const startEdit = () => {
    if (!selected) return;
    setEditingId(selected.id);
    setForm({
      spaceId: selected.spaceId || '',
      categoryId: selected.categoryId || '',
      title: selected.title || '',
      summary: selected.summary || '',
      content: selected.content || '',
      articleType: selected.articleType || 'article',
      status: selected.status || 'published',
      moduleKey: selected.moduleKey || '',
      tags: tagsText(selected.tags),
      allowAi: selected.allowAi !== false,
    });
    setEditing(true);
  };

  const save = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) {
      setStatusText('请输入标题');
      return;
    }
    if (!form.spaceId) {
      setStatusText('请选择空间');
      return;
    }
    const payload = toPayload(form);
    if (editingId) {
      await updateKnowledgeArticle(editingId, payload);
      setStatusText('知识内容已保存');
      await loadArticles(editingId);
      await loadArticle(editingId);
    } else {
      const created = await createKnowledgeArticle(payload);
      setStatusText('知识内容已创建');
      setSelectedId(created?.id || null);
      await loadArticles(created?.id || null);
    }
    setEditing(false);
    setEditingId(null);
  };

  const archive = async () => {
    if (!selected?.id || !window.confirm('确认归档这篇文章?')) return;
    await archiveKnowledgeArticle(selected.id);
    setStatusText('知识内容已归档');
    setSelected(null);
    setSelectedId(null);
    await loadArticles();
  };

  return (
    <>
      <header className="topbar">
        <div>
          <h1>知识库</h1>
          <p>{statusText}</p>
          <nav className="module-nav">
            <Link to="/">首页</Link>
            <Link to="/knowledge" className="active">知识库</Link>
            {user?.role === 'admin' && <Link to="/admin" className="module-auth-link admin-ready">后台</Link>}
          </nav>
        </div>
        <div className="filters">
          <label>
            空间
            <select value={spaceId} onChange={(event) => { setSpaceId(event.target.value); setCategoryId(''); }}>
              {spaces.map(item => <option key={item.id} value={item.id}>{item.spaceName}</option>)}
            </select>
          </label>
          <label>
            分类
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">全部分类</option>
              {visibleCategories.map(item => <option key={item.id} value={item.id}>{item.categoryName}</option>)}
            </select>
          </label>
          <label>
            搜索
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="标题、摘要、正文、标签" />
          </label>
          <button onClick={() => loadArticles()}>搜索</button>
          {mayManage && <button onClick={startCreate}>新增</button>}
        </div>
      </header>

      <main>
        <section className="knowledge-layout">
          <aside className="panel knowledge-list-panel">
            <div className="panel-head">
              <div><h2>知识目录</h2><span>{articles.length} 条内容</span></div>
            </div>
            <div className="knowledge-list">
              {!articles.length ? (
                <div className="knowledge-empty">暂无知识内容</div>
              ) : articles.map(item => (
                <button
                  key={item.id}
                  className={`knowledge-item ${selectedId === item.id ? 'active' : ''}`}
                  onClick={() => setSelectedId(item.id)}
                >
                  <strong>{item.title}</strong>
                  <span>{item.summary || '无摘要'}</span>
                  <small>{statusLabel(item.status)} · {item.categoryName || item.spaceName || '未分类'}</small>
                </button>
              ))}
            </div>
          </aside>

          <section className="panel knowledge-detail-panel">
            {!selected && !editing ? (
              <div className="knowledge-empty">请选择一篇知识内容</div>
            ) : editing ? (
              <form className="knowledge-form" onSubmit={save}>
                <div className="panel-head">
                  <div><h2>{editingId ? '编辑知识内容' : '新增知识内容'}</h2><span>保存后可供授权账号检索和阅读</span></div>
                </div>
                <div className="knowledge-form-grid">
                  <label>空间
                    <select value={form.spaceId} onChange={(event) => setForm({ ...form, spaceId: event.target.value, categoryId: '' })}>
                      {spaces.map(item => <option key={item.id} value={item.id}>{item.spaceName}</option>)}
                    </select>
                  </label>
                  <label>分类
                    <select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
                      <option value="">未分类</option>
                      {formCategories.map(item => <option key={item.id} value={item.id}>{item.categoryName}</option>)}
                    </select>
                  </label>
                  <label>状态
                    <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                      <option value="published">已发布</option>
                      <option value="draft">草稿</option>
                    </select>
                  </label>
                  <label>关联模块
                    <input value={form.moduleKey} onChange={(event) => setForm({ ...form, moduleKey: event.target.value })} placeholder="retail / wholesale / reports" />
                  </label>
                </div>
                <label>标题
                  <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
                </label>
                <label>摘要
                  <textarea value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} />
                </label>
                <label>标签
                  <input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="多个标签用逗号分隔" />
                </label>
                <label className="inline-filter">
                  <input
                    type="checkbox"
                    checked={form.allowAi}
                    onChange={(event) => setForm({ ...form, allowAi: event.target.checked })}
                  />
                  允许 AI 助手只读引用
                </label>
                <label>正文
                  <textarea className="knowledge-content-input" value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} />
                </label>
                <div className="knowledge-actions">
                  <button type="submit">保存</button>
                  <button type="button" className="ghost-button" onClick={() => { setEditing(false); setEditingId(null); }}>取消</button>
                </div>
              </form>
            ) : (
              <article className="knowledge-article">
                <div className="panel-head">
                  <div>
                    <h2>{selected.title}</h2>
                    <span>{selected.spaceName || '知识库'} · {selected.categoryName || '未分类'} · {statusLabel(selected.status)}</span>
                  </div>
                  {mayManage && (
                    <div className="knowledge-actions compact">
                      <button onClick={startEdit}>编辑</button>
                      {selected.status !== 'archived' && <button onClick={archive}>归档</button>}
                    </div>
                  )}
                </div>
                <div className="knowledge-tags">
                  {selected.allowAi && <span>AI 可引用</span>}
                  {selected.moduleKey && <span>{selected.moduleKey}</span>}
                  {(selected.tags || []).map(tag => <span key={tag}>{tag}</span>)}
                </div>
                {selected.summary && <p className="knowledge-summary">{selected.summary}</p>}
                <div className="knowledge-body">{selected.content || '暂无正文'}</div>
                <div className="knowledge-attachments">
                  <h2>附件</h2>
                  {!selected.attachments?.length ? (
                    <span>暂无附件</span>
                  ) : selected.attachments.map(item => (
                    <button key={item.id} className="ghost-button" onClick={() => downloadKnowledgeAttachment(item.id, item.originalName)}>
                      {item.originalName}
                    </button>
                  ))}
                </div>
              </article>
            )}
          </section>
        </section>
      </main>
    </>
  );
}
