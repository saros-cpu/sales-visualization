import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Select, DatePicker, InputNumber, Button, Space, message, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { createContract } from '@/api/contracts';
import { getProductOptions, getEntityOptions } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';

export default function ContractAdd() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [productOptions, setProductOptions] = useState<{ value: string; label: string }[]>([]);
  const [customerOptions, setCustomerOptions] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => { getProductOptions().then(setProductOptions); }, []);
  useEffect(() => { getEntityOptions().then(setCustomerOptions); }, []);

  const onFinish = async (values: any) => {
    if (!can('contracts:create')) {
      message.error(t('common.noPermission'));
      return;
    }
    setSaving(true);
    try {
      const payload: Parameters<typeof createContract>[0] = {
        contractNo: values.contractNo,
        appendixNo: values.appendixNo ?? '',
        customerName: values.customerName,
        productName: values.productName,
        signedDate: values.signedDate ? values.signedDate.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        effectiveStart: values.effectiveStart ? values.effectiveStart.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        effectiveEnd: values.effectiveEnd ? values.effectiveEnd.format('YYYY-MM-DD') : dayjs().add(1, 'year').format('YYYY-MM-DD'),
        quantityTons: values.quantityTons ?? 0,
        amountOriginal: values.amountOriginal ?? undefined,
        currency: values.currency ?? undefined,
        remark: values.remark ?? undefined,
      };
      await createContract(payload);
      message.success(t('common.save') + ' ' + t('common.success'));
      form.resetFields();
    } catch {
      message.error(t('common.save') + ' ' + t('common.failed'));
    } finally {
      setSaving(false);
    }
  };

  if (!can('contracts:create')) {
    return <Card title={t('nav.contractAdd')}><Tag color="red">{t('common.noPermission')}</Tag></Card>;
  }

  return (
    <div>
      <Card title={t('nav.contractAdd')}>
        <Form
          form={form}
          layout="vertical"
          style={{ maxWidth: 720 }}
          onFinish={onFinish}
          initialValues={{
            signedDate: dayjs(),
            effectiveStart: dayjs(),
            effectiveEnd: dayjs().add(1, 'year'),
            quantityTons: 0,
          }}
        >
          <Form.Item label={t('common.contractNo')} name="contractNo" rules={[{ required: true, message: t('common.contractNo') + ' ' + t('common.required') }]}>
            <Input />
          </Form.Item>
          <Form.Item label={t('common.appendixNo')} name="appendixNo">
            <Input />
          </Form.Item>
          <Form.Item label={t('common.customerName')} name="customerName" rules={[{ required: true, message: t('common.customerName') + ' ' + t('common.required') }]}>
            <Select options={customerOptions} showSearch optionFilterProp="label" allowClear />
          </Form.Item>
          <Form.Item label={t('common.productName')} name="productName" rules={[{ required: true, message: t('common.productName') + ' ' + t('common.required') }]}>
            <Select options={productOptions} showSearch optionFilterProp="label" allowClear />
          </Form.Item>
          <Space size="large" wrap>
            <Form.Item label={t('common.signedDate')} name="signedDate">
              <DatePicker format="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item label={t('common.effectiveStart')} name="effectiveStart">
              <DatePicker format="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item label={t('common.effectiveEnd')} name="effectiveEnd">
              <DatePicker format="YYYY-MM-DD" />
            </Form.Item>
          </Space>
          <Space size="large" wrap>
            <Form.Item label={t('common.plannedTons')} name="quantityTons">
              <InputNumber min={0} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item label={t('common.amount')} name="amountOriginal">
              <InputNumber min={0} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item label={t('common.currency')} name="currency">
              <Select
                style={{ width: 160 }}
                allowClear
                options={[
                  { value: 'CNY', label: 'CNY' },
                  { value: 'USD', label: 'USD' },
                  { value: 'KGS', label: 'KGS' },
                  { value: 'RUB', label: 'RUB' },
                ]}
              />
            </Form.Item>
          </Space>
          <Form.Item label={t('common.remark')} name="remark">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Space wrap>
            <Button type="primary" htmlType="submit" loading={saving}>{t('common.save')}</Button>
            <Button onClick={() => navigate('/contracts/view')}>{t('nav.contractView')}</Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
