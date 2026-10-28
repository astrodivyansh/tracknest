export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <p className="text-center text-xl font-bold text-indigo-700">TrackNest</p>
        {children}
      </div>
    </main>
  );
}
