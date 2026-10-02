import DashboardLayout from '@/components/DashboardLayout';
import RegisterWizard from '@/components/passport/RegisterWizard';

export const metadata = { title: 'Register material — TRACE' };

export default function NewPassportPage() {
  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Register material</h1>
        <p className="text-gray-500 text-sm mt-1">
          Create an EU DPP-compliant material passport with a tamper-evident fingerprint.
        </p>
      </div>
      <RegisterWizard />
    </DashboardLayout>
  );
}
