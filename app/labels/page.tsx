import { LabelPrintClient } from '@/components/label-print-client';

export const metadata = {
  title: 'Labels',
};

export default function LabelsPage() {
  return <LabelPrintClient fontClassName="press-start-label-font" />;
}
