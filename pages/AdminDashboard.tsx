import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

interface GenerationStatus {
  edition_type: string;
  region: string;
  language: string;
  status: string;
  last_attempt_at: string;
  error_message?: string;
}

interface FailedGeneration {
  edition_type: string;
  region: string;
  language: string;
  error_message: string;
  retry_count: number;
  next_retry_at: string;
}

interface ScheduledLog {
  edition_type: string;
  scheduled_time: string;
  status: string;
  success_count: number;
  error_count: number;
  completed_at?: string;
}

interface CacheAnalytics {
  cache_key: string;
  cache_hits: number;
  cache_misses: number;
  hit_rate: number;
  cost_saved_by_cache: number;
}

export function AdminDashboard() {
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus[]>([]);
  const [failedGenerations, setFailedGenerations] = useState<FailedGeneration[]>([]);
  const [scheduledLogs, setScheduledLogs] = useState<ScheduledLog[]>([]);
  const [cacheAnalytics, setCacheAnalytics] = useState<CacheAnalytics[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadDashboardData();
    // Refresh every 30 seconds
    const interval = setInterval(loadDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadDashboardData() {
    try {
      setRefreshing(true);

      // Fetch generation status for today
      const today = new Date().toISOString().split('T')[0];
      const { data: status } = await supabase
        .from('generation_status')
        .select('*')
        .eq('generation_date', today)
        .order('edition_type, region, language');

      setGenerationStatus(status || []);

      // Fetch failed generations waiting for retry
      const { data: failed } = await supabase
        .from('failed_generations')
        .select('*')
        .eq('is_resolved', false)
        .order('next_retry_at');

      setFailedGenerations(failed || []);

      // Fetch recent scheduled logs
      const { data: logs } = await supabase
        .from('scheduled_generation_logs')
        .select('*')
        .order('scheduled_time', { ascending: false })
        .limit(10);

      setScheduledLogs(logs || []);

      // Fetch cache analytics (7-day average)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: analytics } = await supabase
        .from('cache_analytics')
        .select('*')
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('cache_hits', { ascending: false })
        .limit(20);

      setCacheAnalytics(analytics || []);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'bg-green-100 text-green-900';
      case 'failed':
      case 'retry_failed':
        return 'bg-red-100 text-red-900';
      case 'pending':
      case 'generating':
        return 'bg-yellow-100 text-yellow-900';
      case 'recovered':
        return 'bg-blue-100 text-blue-900';
      default:
        return 'bg-gray-100 text-gray-900';
    }
  };

  const successRate = (hits: number, misses: number) => {
    const total = hits + misses;
    return total === 0 ? 0 : ((hits / total) * 100).toFixed(1);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading admin dashboard...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold">Admin Dashboard</h1>
          <button
            onClick={loadDashboardData}
            disabled={refreshing}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* ==================== GENERATION STATUS ==================== */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-4">📊 Today's Generation Status</h2>
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="px-4 py-2 text-left">Edition</th>
                  <th className="px-4 py-2 text-left">Region</th>
                  <th className="px-4 py-2 text-left">Language</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Last Attempt</th>
                  <th className="px-4 py-2 text-left">Error</th>
                </tr>
              </thead>
              <tbody>
                {generationStatus.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-4 text-center text-gray-500">
                      No generations scheduled for today yet
                    </td>
                  </tr>
                ) : (
                  generationStatus.map((item, idx) => (
                    <tr key={idx} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">{item.edition_type}</td>
                      <td className="px-4 py-2">{item.region}</td>
                      <td className="px-4 py-2">{item.language}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-1 rounded text-sm font-medium ${getStatusColor(item.status)}`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-600">
                        {item.last_attempt_at ? new Date(item.last_attempt_at).toLocaleTimeString() : '-'}
                      </td>
                      <td className="px-4 py-2 text-sm text-red-600">{item.error_message || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ==================== FAILED GENERATIONS ==================== */}
        {failedGenerations.length > 0 && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-4">⚠️ Failed Generations (Auto-Retry Pending)</h2>
            <div className="bg-white rounded-lg shadow overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-100 border-b">
                  <tr>
                    <th className="px-4 py-2 text-left">Edition</th>
                    <th className="px-4 py-2 text-left">Region</th>
                    <th className="px-4 py-2 text-left">Language</th>
                    <th className="px-4 py-2 text-left">Attempts</th>
                    <th className="px-4 py-2 text-left">Error</th>
                    <th className="px-4 py-2 text-left">Next Retry</th>
                  </tr>
                </thead>
                <tbody>
                  {failedGenerations.map((item, idx) => (
                    <tr key={idx} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">{item.edition_type}</td>
                      <td className="px-4 py-2">{item.region}</td>
                      <td className="px-4 py-2">{item.language}</td>
                      <td className="px-4 py-2">
                        <span className="px-2 py-1 bg-yellow-100 text-yellow-900 rounded text-sm font-medium">
                          {item.retry_count}/3
                        </span>
                      </td>
                      <td className="px-4 py-2 text-sm text-red-600">{item.error_message}</td>
                      <td className="px-4 py-2 text-sm">
                        {new Date(item.next_retry_at).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ==================== SCHEDULED LOGS ==================== */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-4">📅 Recent Scheduled Generations</h2>
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="px-4 py-2 text-left">Edition</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Success</th>
                  <th className="px-4 py-2 text-left">Failed</th>
                  <th className="px-4 py-2 text-left">Scheduled</th>
                  <th className="px-4 py-2 text-left">Completed</th>
                </tr>
              </thead>
              <tbody>
                {scheduledLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-4 text-center text-gray-500">
                      No scheduled generations yet
                    </td>
                  </tr>
                ) : (
                  scheduledLogs.map((log, idx) => (
                    <tr key={idx} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">{log.edition_type}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-1 rounded text-sm font-medium ${getStatusColor(log.status)}`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-green-600 font-medium">✅ {log.success_count}</td>
                      <td className="px-4 py-2 text-red-600 font-medium">❌ {log.error_count}</td>
                      <td className="px-4 py-2 text-sm">
                        {new Date(log.scheduled_time).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-2 text-sm">
                        {log.completed_at ? new Date(log.completed_at).toLocaleTimeString() : '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ==================== CACHE ANALYTICS ==================== */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-4">💾 Cache Analytics (7-Day)</h2>
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="px-4 py-2 text-left">Edition</th>
                  <th className="px-4 py-2 text-left">Cache Hits</th>
                  <th className="px-4 py-2 text-left">Cache Misses</th>
                  <th className="px-4 py-2 text-left">Hit Rate</th>
                  <th className="px-4 py-2 text-left">Cost Saved</th>
                </tr>
              </thead>
              <tbody>
                {cacheAnalytics.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-4 text-center text-gray-500">
                      No cache analytics data yet
                    </td>
                  </tr>
                ) : (
                  cacheAnalytics.map((item, idx) => (
                    <tr key={idx} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-sm">{item.cache_key}</td>
                      <td className="px-4 py-2 text-green-600 font-medium">{item.cache_hits}</td>
                      <td className="px-4 py-2 text-red-600">{item.cache_misses}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-24 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full"
                              style={{ width: `${(item.hit_rate || 0) * 100}%` }}
                            ></div>
                          </div>
                          <span className="text-sm font-medium">{successRate(item.cache_hits, item.cache_misses)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-green-600 font-medium">
                        ${item.cost_saved_by_cache.toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;
