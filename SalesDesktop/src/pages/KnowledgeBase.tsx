import { useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import {
  BookOutlined,
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import {
  archiveKnowledgeArticle,
  createKnowledgeArticle,
  deleteKnowledgeAttachment,
  downloadKnowledgeAttachment,
  getKnowledgeArticle,
  getKnowledgeArticles,
  getKnowledgeBootstrap,
  updateKnowledgeArticle,
  uploadKnowledgeAttachment,
  type KnowledgeArticle,
  type KnowledgeArticlePayload,
  type KnowledgeCategory,
  type KnowledgeSpace,
} from '@/api/knowledge';

const { Paragraph, Text, Title } = Typography;

const moduleOptions = [
  { value: 'dashboard', label: '数据可视化' },
  { value: 'retail', label: '零售' },
  { value: 'wholesale', label: '批发' },
  { value: 'reports', label: '报表' },
  { value: 'contracts', label: '合同' },
  { value: 'materials', label: '物资调拨' },
  { value: 'procurement', label: '采购' },
  { value: 'system_health', label: '系统运行' },
];

const articleTypeOptions = [
  { value: 'article', label: '文章' },
  { value: 'manual', label: '操作手册' },
  { value: 'metric', label: '数据口径' },
  { value: 'faq', label: '常见问题' },
  { value: 'policy', label: '制度流程' },
];

const statusOptions = [
  { value: 'published', label: '已发布' },
  { value: 'draft', label: '草稿' },
  { value: 'archived', label: '已归档' },
];

function statusColor(status?: string) {
  if (status === 'published') return 'green';
  if (status === 'archived') return 'red';
  return 'orange';
}

function compactText(value?: string, fallback = '-') {
  return (value || '').trim() || fallback;
}

function fileSizeText(size?: number) {
  const value = Number(size || 0);
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

export default function KnowledgeBase() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const { user, can } = useAuth();
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>([]);
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [articleLoading, setArticleLoading] = useState(false);
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<KnowledgeArticle | null>(null);
  const [spaceId, setSpaceId] = useState<number | undefined>();
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<KnowledgeArticle | null>(null);
  const [form] = Form.useForm();
  const formSpaceId = Form.useWatch('spaceId', form);
  const isAdmin = user?.role === 'admin';
  const mayManage = canManage || isAdmin || can('knowledge:manage');

  const activeSpace = useMemo(() => spaces.find(item => item.id === spaceId) || spaces[0], [spaces, spaceId]);
  const visibleCategories = useMemo(
    () => categories.filter(item => !spaceId || item.spaceId === spaceId),
    [categories, spaceId],
  );
  const formCategories = useMemo(
    () => categories.filter(item => !formSpaceId || item.spaceId === formSpaceId),
    [categories, formSpaceId],
  );

  const loadBootstrap = async () => {
    const data = await getKnowledgeBootstrap();
    setSpaces(data.spaces || []);
    setCategories(data.categories || []);
    setCanManage(Boolean(data.canManage));
    if (!spaceId && data.spaces?.[0]) setSpaceId(data.spaces[0].id);
  };

  const loadArticles = async (preferredId?: number | null) => {
    setLoading(true);
    try {
      const data = await getKnowledgeArticles({
        q: query,
        spaceId,
        categoryId,
      });
      const items = data.items || [];
      setArticles(items);
      const nextId = preferredId && items.some(item => item.id === preferredId)
        ? preferredId
        : selectedId && items.some(item => item.id === selectedId)
          ? selectedId
          : items[0]?.id;
      setSelectedId(nextId || null);
      if (!nextId) setSelectedArticle(null);
    } catch (err: any) {
      message.error(err?.message || '知识库加载失败');
    } finally {
      setLoading(false);
    }
  };

  const loadArticle = async (id: number | null) => {
    if (!id) {
      setSelectedArticle(null);
      return;
    }
    setArticleLoading(true);
    try {
      setSelectedArticle(await getKnowledgeArticle(id));
    } catch (err: any) {
      message.error(err?.message || '文章加载失败');
    } finally {
      setArticleLoading(false);
    }
  };

  useEffect(() => {
    loadBootstrap().catch((err: any) => message.error(err?.message || '知识库初始化失败'));
  }, []);

  useEffect(() => {
    if (spaces.length) loadArticles();
  }, [spaces.length, spaceId, categoryId]);

  useEffect(() => {
    loadArticle(selectedId);
  }, [selectedId]);

  const openEditor = (article?: KnowledgeArticle | null) => {
    const source = article || null;
    setEditing(source);
    form.resetFields();
    form.setFieldsValue({
      spaceId: source?.spaceId || activeSpace?.id,
      categoryId: source?.categoryId || undefined,
      title: source?.title || '',
      summary: source?.summary || '',
      content: source?.content || '',
      articleType: source?.articleType || 'article',
      status: source?.status || 'published',
      moduleKey: source?.moduleKey || undefined,
      tags: source?.tags || [],
      visibleRoleCodes: source?.visibleRoleCodes || [],
      visibleDepartmentIds: (source?.visibleDepartmentIds || []).map(String),
      allowAi: source?.allowAi !== false,
    });
    setModalOpen(true);
  };

  const normalizePayload = (values: any): KnowledgeArticlePayload => ({
    ...values,
    categoryId: values.categoryId || null,
    tags: values.tags || [],
    visibleRoleCodes: values.visibleRoleCodes || [],
    visibleDepartmentIds: (values.visibleDepartmentIds || [])
      .map((item: string) => Number(item))
      .filter((item: number) => Number.isFinite(item)),
    allowAi: values.allowAi !== false,
  });

  const saveArticle = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const payload = normalizePayload(values);
      if (editing?.id) {
        await updateKnowledgeArticle(editing.id, payload);
        message.success(t('common.saved'));
        setSelectedId(editing.id);
      } else {
        const result = await createKnowledgeArticle(payload);
        message.success(t('common.created'));
        setSelectedId(result?.id || null);
        await loadArticles(result?.id || null);
        if (result?.id) await loadArticle(result.id);
        setModalOpen(false);
        return;
      }
      setModalOpen(false);
      await loadArticles(editing?.id || null);
      if (editing?.id) await loadArticle(editing.id);
    } catch (err: any) {
      message.error(err?.message || t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const archiveArticle = async (id: number) => {
    await archiveKnowledgeArticle(id);
    message.success('已归档');
    setSelectedId(null);
    setSelectedArticle(null);
    await loadArticles();
  };

  const uploadAttachment = async (options: any) => {
    if (!selectedArticle?.id) {
      options.onError?.(new Error('article_required'));
      return;
    }
    try {
      await uploadKnowledgeAttachment(selectedArticle.id, options.file as File);
      options.onSuccess?.({}, options.file);
      message.success('附件已上传');
      await loadArticle(selectedArticle.id);
    } catch (err: any) {
      options.onError?.(err);
      message.error(err?.message || '附件上传失败');
    }
  };

  const removeAttachment = async (attachmentId: number) => {
    if (!isAdmin || !selectedArticle?.id) {
      message.error(t('common.noPermission'));
      return;
    }
    try {
      await deleteKnowledgeAttachment(attachmentId);
      message.success(t('common.deleted'));
      await loadArticle(selectedArticle.id);
    } catch (err: any) {
      message.error(err?.message || t('common.deleteFailedRetry'));
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ marginBottom: 4 }}>{t('nav.knowledgeBase')}</Title>
          <Text type="secondary">沉淀项目操作、报表口径、业务流程和综合工作资料，AI 助手只读引用已授权内容。</Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => { loadBootstrap(); loadArticles(); }} loading={loading}>
            {t('common.update')}
          </Button>
          {mayManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>
              {t('common.create')}
            </Button>
          )}
        </Space>
      </Space>

      <Card size="small">
        <Space wrap>
          <Select
            style={{ width: 220 }}
            value={spaceId}
            options={spaces.map(item => ({ value: item.id, label: item.spaceName }))}
            onChange={(value) => { setSpaceId(value); setCategoryId(undefined); }}
          />
          <Select
            allowClear
            style={{ width: 220 }}
            placeholder="分类"
            value={categoryId}
            options={visibleCategories.map(item => ({ value: item.id, label: item.categoryName }))}
            onChange={setCategoryId}
          />
          <Input.Search
            allowClear
            style={{ width: 360 }}
            placeholder="搜索标题、摘要、正文或标签"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onSearch={() => loadArticles()}
          />
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={7}>
          <Card
            size="small"
            title={<Space><BookOutlined />{activeSpace?.spaceName || '知识库'}</Space>}
            loading={loading}
            style={{ minHeight: 560 }}
          >
            <List
              rowKey="id"
              dataSource={articles}
              locale={{ emptyText: <Empty description="暂无知识内容" /> }}
              renderItem={(item) => (
                <List.Item
                  style={{
                    cursor: 'pointer',
                    padding: '12px 4px',
                    background: selectedId === item.id ? '#fff1f0' : undefined,
                  }}
                  onClick={() => setSelectedId(item.id)}
                >
                  <List.Item.Meta
                    title={(
                      <Space size={6} wrap>
                        <Text strong>{item.title}</Text>
                        <Tag color={statusColor(item.status)}>{statusOptions.find(opt => opt.value === item.status)?.label || item.status}</Tag>
                      </Space>
                    )}
                    description={(
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <Text type="secondary" ellipsis>{compactText(item.summary, '无摘要')}</Text>
                        <Space size={4} wrap>
                          {item.categoryName && <Tag>{item.categoryName}</Tag>}
                          {(item.tags || []).slice(0, 3).map(tag => <Tag key={tag} color="blue">{tag}</Tag>)}
                        </Space>
                      </Space>
                    )}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} lg={17}>
          <Card
            size="small"
            loading={articleLoading}
            title={selectedArticle?.title || '知识详情'}
            extra={selectedArticle && (
              <Space>
                {mayManage && (
                  <Tooltip title="编辑文章">
                    <Button icon={<EditOutlined />} onClick={() => openEditor(selectedArticle)} />
                  </Tooltip>
                )}
                {mayManage && selectedArticle.status !== 'archived' && (
                  <Popconfirm
                    title="确认归档这篇文章?"
                    okText={t('common.confirm')}
                    cancelText={t('common.cancel')}
                    onConfirm={() => archiveArticle(selectedArticle.id)}
                  >
                    <Button danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                )}
              </Space>
            )}
            style={{ minHeight: 560 }}
          >
            {!selectedArticle ? (
              <Empty description="请选择一篇知识内容" />
            ) : (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Space wrap>
                  <Tag color={statusColor(selectedArticle.status)}>
                    {statusOptions.find(item => item.value === selectedArticle.status)?.label || selectedArticle.status}
                  </Tag>
                  {selectedArticle.spaceName && <Tag>{selectedArticle.spaceName}</Tag>}
                  {selectedArticle.categoryName && <Tag>{selectedArticle.categoryName}</Tag>}
                  {selectedArticle.moduleKey && <Tag color="purple">{selectedArticle.moduleKey}</Tag>}
                  {selectedArticle.allowAi && <Tag color="cyan">AI 可引用</Tag>}
                  <Text type="secondary">阅读 {selectedArticle.viewCount || 0}</Text>
                  <Text type="secondary">更新 {selectedArticle.updatedAt || selectedArticle.createdAt || '-'}</Text>
                </Space>

                {selectedArticle.summary && (
                  <Paragraph style={{ fontSize: 14, color: '#5a5a5a' }}>{selectedArticle.summary}</Paragraph>
                )}

                <div
                  style={{
                    minHeight: 220,
                    padding: 16,
                    border: '1px solid #f0f0f0',
                    borderRadius: 6,
                    background: '#fafafa',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    lineHeight: 1.7,
                  }}
                >
                  {selectedArticle.content || '暂无正文'}
                </div>

                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                    <Text strong><PaperClipOutlined /> 附件</Text>
                    {mayManage && selectedArticle.status !== 'archived' && (
                      <Upload customRequest={uploadAttachment} showUploadList={false}>
                        <Button icon={<UploadOutlined />}>上传附件</Button>
                      </Upload>
                    )}
                  </Space>
                  <List
                    size="small"
                    dataSource={selectedArticle.attachments || []}
                    locale={{ emptyText: '暂无附件' }}
                    renderItem={(item) => (
                      <List.Item
                        actions={[
                          <Button
                            key="download"
                            type="link"
                            onClick={() => downloadKnowledgeAttachment(item.id, item.originalName)}
                          >
                            下载
                          </Button>,
                          ...(isAdmin ? [
                            <Popconfirm
                              key="delete"
                              title="确认删除这个附件?"
                              okText={t('common.confirm')}
                              cancelText={t('common.cancel')}
                              onConfirm={() => removeAttachment(item.id)}
                            >
                              <Button danger type="link">
                                {t('common.delete')}
                              </Button>
                            </Popconfirm>,
                          ] : []),
                        ]}
                      >
                        <List.Item.Meta
                          title={item.originalName}
                          description={`${fileSizeText(item.fileSize)} · ${item.createdAt || '-'}`}
                        />
                      </List.Item>
                    )}
                  />
                </Space>

                {mayManage && (
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Text strong><HistoryOutlined /> 版本记录</Text>
                    <List
                      size="small"
                      dataSource={selectedArticle.versions || []}
                      locale={{ emptyText: '暂无版本记录' }}
                      renderItem={(item) => (
                        <List.Item>
                          <Space wrap>
                            <Tag>v{item.versionNo}</Tag>
                            <Text>{item.title}</Text>
                            <Text type="secondary">{item.createdAt || '-'}</Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Space>
                )}
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        title={editing?.id ? '编辑知识内容' : '新增知识内容'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={saveArticle}
        confirmLoading={saving}
        width={820}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ articleType: 'article', status: 'published', allowAi: true }}>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="spaceId" label="空间" rules={[{ required: true, message: '请选择空间' }]}>
                <Select options={spaces.map(item => ({ value: item.id, label: item.spaceName }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="categoryId" label="分类">
                <Select allowClear options={formCategories.map(item => ({ value: item.id, label: item.categoryName }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input maxLength={255} />
          </Form.Item>
          <Form.Item name="summary" label="摘要">
            <Input.TextArea rows={2} maxLength={1000} showCount />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item name="articleType" label="类型">
                <Select options={articleTypeOptions} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="status" label="状态">
                <Select options={statusOptions} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="moduleKey" label="关联模块">
                <Select allowClear options={moduleOptions} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="tags" label="标签">
            <Select mode="tags" open={false} placeholder="输入后按回车" />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="visibleRoleCodes" label="限定角色">
                <Select mode="tags" open={false} placeholder="不填则所有有知识库权限的账号可见" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="visibleDepartmentIds" label="限定部门 ID">
                <Select mode="tags" open={false} placeholder="不填则不限部门" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="allowAi" label="允许 AI 助手只读引用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="content" label="正文">
            <Input.TextArea rows={12} placeholder="支持直接粘贴 Markdown 或普通文本" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
