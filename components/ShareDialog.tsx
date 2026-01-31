'use client';

import { useState, useEffect } from 'react';
import { Copy, X, Link as LinkIcon, Loader } from 'lucide-react';

interface ShareLink {
  id: string;
  share_token: string;
  share_url: string;
  created_at: string;
  expires_at: string;
  access_count: number;
}

interface ShareDialogProps {
  editionId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function ShareDialog({
  editionId,
  isOpen,
  onClose,
}: ShareDialogProps) {
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Fetch existing share links
  useEffect(() => {
    if (isOpen) {
      fetchShareLinks();
    }
  }, [isOpen]);

  const fetchShareLinks = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/share-edition?edition_id=${editionId}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('supabase.auth.token')}`,
          },
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setShareLinks(data.shares || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load share links'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const createShareLink = async () => {
    setIsCreating(true);
    setError(null);
    try {
      const response = await fetch('/api/share-edition', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('supabase.auth.token')}`,
        },
        body: JSON.stringify({ edition_id: editionId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setShareLinks([data, ...shareLinks]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to create share link'
      );
    } finally {
      setIsCreating(false);
    }
  };

  const revokeShareLink = async (shareId: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/share-edition?share_id=${shareId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('supabase.auth.token')}`,
        },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error);
      }
      setShareLinks(shareLinks.filter((link) => link.id !== shareId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke share');
    }
  };

  const copyToClipboard = (url: string, linkId: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(linkId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getDaysUntilExpiration = (expiresAt: string) => {
    const now = new Date();
    const expiry = new Date(expiresAt);
    const days = Math.ceil(
      (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    return days > 0 ? days : 0;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LinkIcon className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Share Edition</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {/* Create New Share */}
          <button
            onClick={createShareLink}
            disabled={isCreating}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition"
          >
            {isCreating ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <LinkIcon className="w-4 h-4" />
                Create Share Link
              </>
            )}
          </button>

          {/* Existing Share Links */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">
              Share Links ({shareLinks.length})
            </h3>

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : shareLinks.length === 0 ? (
              <p className="text-gray-500 text-sm">
                No share links yet. Create one above to start sharing.
              </p>
            ) : (
              <div className="space-y-3">
                {shareLinks.map((link) => {
                  const daysLeft = getDaysUntilExpiration(link.expires_at);
                  const isExpiringSoon = daysLeft <= 7 && daysLeft > 0;
                  const isExpired = daysLeft === 0;

                  return (
                    <div
                      key={link.id}
                      className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          {/* Share URL */}
                          <div className="bg-gray-50 p-2 rounded text-sm font-mono text-gray-700 break-all mb-2">
                            {link.share_url}
                          </div>

                          {/* Metadata */}
                          <div className="text-xs text-gray-600 space-y-1">
                            <p>
                              Created: {formatDate(link.created_at)}
                            </p>
                            <p>
                              Expires: {formatDate(link.expires_at)}
                              {isExpiringSoon && (
                                <span className="ml-2 text-orange-600 font-medium">
                                  ({daysLeft} days left)
                                </span>
                              )}
                              {isExpired && (
                                <span className="ml-2 text-red-600 font-medium">
                                  (expired)
                                </span>
                              )}
                            </p>
                            <p>Accessed {link.access_count} times</p>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2 flex-shrink-0">
                          <button
                            onClick={() =>
                              copyToClipboard(link.share_url, link.id)
                            }
                            className={`p-2 rounded transition ${
                              copiedId === link.id
                                ? 'bg-green-100 text-green-700'
                                : 'hover:bg-gray-100 text-gray-700'
                            }`}
                            title="Copy to clipboard"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => revokeShareLink(link.id)}
                            className="p-2 hover:bg-red-100 text-red-700 rounded transition"
                            title="Revoke share"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
            <p className="font-medium mb-1">Share Link Info:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Links expire after 30 days</li>
              <li>No login required to access shared editions</li>
              <li>You can revoke links anytime</li>
              <li>Access count is tracked for analytics</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
