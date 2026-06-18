"use client";

import { Suspense, useState, useEffect, use } from "react";
import AdminLeaderboard from "../AdminLeaderboard";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey } from "@solana/web3.js";
import { decodeAccount, retryWithBackoff } from "@/lib/program-ix";
import { updateProjectBrandingTx } from "@/lib/actions";
import { ImageUpload } from "@/components/ImageUpload";
import toast from "react-hot-toast";
import { getSolanaErrorDetails } from "@/lib/program-ix";
import { ProjectBrandingModal } from "@/components/ProjectBrandingModal";

import { resolveIpfsUrl } from "@/lib/helpers";

function AdminLeaderboardPageInner({ slug }: { slug: string }) {
  const wallet = useWallet();
  const [showBrandingModal, setShowBrandingModal] = useState(false);
  const [slugProj, setSlugProj] = useState<any>(null);
  const [slugLoaded, setSlugLoaded] = useState(false);
  const [brandingRefreshKey, setBrandingRefreshKey] = useState(0);

  const [localBg, setLocalBg] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== "undefined") {
      const localBranding = localStorage.getItem(`project_branding_${slug}`);
      if (localBranding) {
        try {
          const parsed = JSON.parse(localBranding);
          if (parsed.bgUri) setLocalBg(parsed.bgUri);
        } catch {}
      }
    }
  }, [slug]);

  const bgUri = resolveIpfsUrl(slugProj?.bgUri || localBg);

  const adminBgStyle = bgUri ? {
    backgroundImage: `radial-gradient(circle at top, rgba(10, 10, 10, 0.4) 0%, rgba(10, 10, 10, 0.85) 100%), url('${bgUri}')`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundAttachment: 'fixed',
  } : {};

  // Listen for the open-project-branding event
  useEffect(() => {
    const handleOpenProjectBranding = () => setShowBrandingModal(true);
    window.addEventListener('open-project-branding', handleOpenProjectBranding);
    return () => window.removeEventListener('open-project-branding', handleOpenProjectBranding);
  }, []);

  // Fetch the project account to get the current state for the modal
  const fetchProject = async () => {
    try {
      const conn = new Connection(process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com", "confirmed");
      const pgId = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4");
      const [pk] = PublicKey.findProgramAddressSync([Buffer.from("project"), Buffer.from(slug)], pgId);

      const acc = await retryWithBackoff(() => conn.getAccountInfo(pk), "getAccountInfo(project)");
      if (acc) {
        const decoded = decodeAccount<any>("Project", acc.data);
        if (typeof window !== "undefined" && decoded.slug) {
          const localBranding = localStorage.getItem(`project_branding_${decoded.slug}`);
          if (localBranding) {
            try {
              const parsed = JSON.parse(localBranding);
              decoded.name = parsed.name || decoded.name;
              decoded.description = parsed.description || decoded.description;
              decoded.logoUri = parsed.logoUri || decoded.logoUri;
              decoded.bgUri = parsed.bgUri || decoded.bgUri;
              decoded.themeColor = parsed.themeColor || decoded.themeColor;
              decoded.nothingRewardImage = parsed.nothingRewardImage || decoded.nothingRewardImage;
            } catch {}
          }
        }
        setSlugProj(decoded);
      }
      setSlugLoaded(true);
      setBrandingRefreshKey((prev) => prev + 1); // Increment refresh key
    } catch (err) {
      console.error(err);
      setSlugLoaded(true);
    }
  };

  useEffect(() => {
    fetchProject();
  }, [slug]);

  return (
    <div className="w-full min-h-screen p-6" style={adminBgStyle}>
      <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black text-[#0f2618]">Project Analytics</h1>
          <p className="text-sm text-[#2d5a3f] mt-1">Manage leaderboard snapshots and activity for {slug}.</p>
        </div>
      </div>
      
      {showBrandingModal && slugProj && (
        <ProjectBrandingModal
          slug={slug}
          slugProj={slugProj}
          onClose={() => setShowBrandingModal(false)}
          onRefresh={fetchProject}
        />
      )}
      
      <AdminLeaderboard slug={slug} refreshKey={brandingRefreshKey} />
      </div>
    </div>
  );
}

export default function AdminLeaderboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  return (
    <Suspense fallback={<div className="p-6 text-[#3d6b4e] animate-pulse">Loading leaderboard…</div>}>
      <AdminLeaderboardPageInner slug={slug} />
    </Suspense>
  );
}
