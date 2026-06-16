import { Suspense } from "react";
import ProjectView from "./ProjectView.client";

export default async function ProjectPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <Suspense fallback={<div className="animate-pulse p-8 max-w-5xl mx-auto space-y-4">
    <div className="h-44 bg-gray-900 rounded-2xl" />
    <div className="h-6 w-48 bg-gray-900 rounded" />
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {[1,2,3].map(i => <div key={i} className="h-56 bg-gray-900 rounded-xl" />)}
    </div>
  </div>}>
    <ProjectView slug={slug} />
  </Suspense>;
}
