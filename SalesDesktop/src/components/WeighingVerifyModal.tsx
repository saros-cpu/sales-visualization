import { useState } from 'react';
import { Modal, Form, Input, InputNumber, Descriptions, message, Button, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { verifyWeighing, WeighingItem } from '@/api/weighing';

interface Props {
  record: WeighingItem | null;
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface FieldEdit {
  field: string;
  label: string;
  oldValue: string;
  newValue: string;
}

const CORRECTABLE_FIELDS: { key: keyof WeighingItem; fieldName: string; labelKey: string }[] = [
  { key: 'vehicleNo', fieldName: 'vehicle_no', labelKey: 'vehicleNo' },
  { key: 'senderName', fieldName: 'sender_name', labelKey: 'senderName' },
  { key: 'receiverName', fieldName: 'receiver_name', labelKey: 'receiverName' },
  { key: 'rawProductName', fieldName: 'raw_product_name', labelKey: 'rawProductName' },
];

export default function WeighingVerifyModal({ record, visible, onClose, onSuccess }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});

  if (!record) return null;

  const changedFields: FieldEdit[] = CORRECTABLE_FIELDS
    .filter((f) => {
      const newVal = edits[f.key]?.trim();
      return newVal && newVal !== String(record[f.key] ?? '');
    })
    .map((f) => ({
      field: f.fieldName,
      label: t(`weighing.${f.labelKey}`),
      oldValue: String(record[f.key] ?? ''),
      newValue: edits[f.key]!.trim(),
    }));

  const handleSubmit = async () => {
    if (!user || changedFields.length === 0) return;
    setLoading(true);
    try {
      await Promise.all(
        changedFields.map((cf) =>
          verifyWeighing({
            weighing_source: record.source,
            weighing_id: parseInt(record.id, 10),
            field_name: cf.field,
            old_value: cf.oldValue,
            new_value: cf.newValue,
            operator_id: user.id,
          })
        )
      );
      message.success(t('weighing.corrected', { count: changedFields.length }));
      onSuccess();
      onClose();
    } catch {
      message.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={`${t('weighing.verify')} - ${record.weighSerialNo}`}
      open={visible}
      onCancel={onClose}
      width={700}
      footer={
        <Space>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="primary" loading={loading} disabled={changedFields.length === 0} onClick={handleSubmit}>
            {t('common.save')}
          </Button>
        </Space>
      }
    >
      <Descriptions column={2} size="small" bordered style={{ marginBottom: 24 }}>
        <Descriptions.Item label={t('weighing.businessDate')}>{record.businessDate}</Descriptions.Item>
        <Descriptions.Item label={t('weighing.weighSerialNo')}>{record.weighSerialNo}</Descriptions.Item>
        <Descriptions.Item label={t('weighing.grossWeight')}>{record.grossWeight}</Descriptions.Item>
        <Descriptions.Item label={t('weighing.tareWeight')}>{record.tareWeight}</Descriptions.Item>
        <Descriptions.Item label={t('weighing.netWeight')}>{record.netWeight}</Descriptions.Item>
        <Descriptions.Item label={t('weighing.remark')}>{record.remark}</Descriptions.Item>
      </Descriptions>

      <Form layout="vertical">
        {CORRECTABLE_FIELDS.map((f) => {
          const origValue = String(record[f.key] ?? '');
          return (
            <Form.Item key={f.key} label={t(`weighing.${f.labelKey}`)}>
              <Space style={{ width: '100%' }}>
                <Input
                  style={{ width: 300 }}
                  value={edits[f.key] ?? origValue}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
                {edits[f.key] !== undefined && edits[f.key] !== origValue && (
                  <span style={{ color: '#999' }}>{t('weighing.originalValue', { value: origValue })}</span>
                )}
              </Space>
            </Form.Item>
          );
        })}
      </Form>
    </Modal>
  );
}
