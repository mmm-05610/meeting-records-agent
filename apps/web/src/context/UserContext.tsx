import { useRouter } from 'next/router';
import { r2rClient } from 'r2r-js';
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';

import { AuthState, Pipeline, UserContextProps } from '@/types';

/**
 * 会议记录 Web v0.1 —— 登录态由服务端会话决定。
 *
 * 浏览器只访问同源 `/api/*`；R2R / Agent 的地址与凭据只存在服务端。
 * 这里不再直接连接 R2R API，也不在浏览器保存任何 token。
 */

function isAuthState(obj: any): obj is AuthState {
  const validRoles = ['admin', 'user', null];
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.isAuthenticated === 'boolean' &&
    (typeof obj.email === 'string' || obj.email === null) &&
    (validRoles.includes(obj.userRole) || obj.userRole === null)
  );
}

const EMPTY_AUTH_STATE: AuthState = {
  isAuthenticated: false,
  email: null,
  userRole: null,
  userId: null,
};

interface ApiEnvelope {
  error?: { category?: string; message?: string; fields?: string[] };
}

class SameOriginError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'SameOriginError';
    this.status = status;
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const envelope = (payload as ApiEnvelope | null)?.error;
    throw new SameOriginError(
      response.status,
      envelope?.message || `请求失败（HTTP ${response.status}）。`
    );
  }
  return (payload ?? {}) as T;
}

interface SessionUser {
  id: string;
  email: string;
  role?: 'admin' | 'user';
}

/**
 * 同源门面：保留 r2r-js 的调用形状，但全部走本应用的 `/api/*`，
 * 浏览器因此既不持有 R2R 凭据，也不直接访问 R2R 端口。
 */
function createSameOriginClient(): r2rClient {
  const listProjects = async () => {
    const data = await apiRequest<{
      projects?: Array<{
        id: string;
        name: string;
        description?: string | null;
        created_at?: string | null;
      }>;
    }>('/api/projects');
    return (data.projects ?? []).map((project) => ({
      id: project.id,
      ownerId: '',
      name: project.name,
      description: project.description ?? undefined,
      graphClusterStatus: 'pending',
      graphSyncStatus: 'pending',
      createdAt: project.created_at ?? '',
      updatedAt: project.created_at ?? '',
      userCount: 1,
      documentCount: 0,
    }));
  };

  const listDocumentsOfProject = async (projectId: string) => {
    const data = await apiRequest<{ meetings?: any[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/meetings?status=all`
    );
    return (data.meetings ?? []).map((meeting) => ({
      id: meeting.document_id,
      collectionIds: [meeting.collection_id],
      ownerId: '',
      documentType: /\.md$/i.test(meeting.title ?? '') ? 'md' : 'txt',
      metadata: {
        meeting_date: meeting.meeting_date,
        time_precision: meeting.time_precision,
        record_kind: meeting.record_kind,
        participants: meeting.participants,
        content_sha256: meeting.content_sha256,
        schema_version: 'meeting-v0.1',
      },
      title: meeting.title,
      version: 'v0',
      sizeInBytes: meeting.size_in_bytes,
      ingestionStatus:
        meeting.status === 'ready'
          ? 'success'
          : meeting.status === 'failed'
            ? 'failed'
            : meeting.status === 'processing'
              ? 'parsing'
              : 'pending',
      extractionStatus:
        meeting.status === 'ready'
          ? 'success'
          : meeting.status === 'failed'
            ? 'failed'
            : 'pending',
      createdAt: meeting.created_at,
      updatedAt: meeting.created_at,
    }));
  };

  const listAllDocuments = async () => {
    const projects = await listProjects();
    const documents: any[] = [];
    for (const project of projects) {
      documents.push(...(await listDocumentsOfProject(project.id)));
    }
    return documents;
  };

  const client = {
    documents: {
      list: async (options?: { offset?: number; limit?: number }) => {
        const all = await listAllDocuments();
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? all.length;
        return {
          results: all.slice(offset, offset + limit),
          totalEntries: all.length,
        };
      },
    },
    collections: {
      list: async () => {
        const results = await listProjects();
        return { results, totalEntries: results.length };
      },
      retrieve: async (options: { id: string }) => {
        const results = await listProjects();
        const found = results.find((item) => item.id === options.id);
        if (!found) {
          throw new Error('项目不存在或无权访问。');
        }
        return { results: found };
      },
      listDocuments: async (options: {
        id: string;
        offset?: number;
        limit?: number;
      }) => {
        const all = await listDocumentsOfProject(options.id);
        const offset = options.offset ?? 0;
        const limit = options.limit ?? all.length;
        return {
          results: all.slice(offset, offset + limit),
          totalEntries: all.length,
        };
      },
      removeDocument: async (options: { id: string; documentId: string }) => {
        await apiRequest(
          `/api/meetings/${encodeURIComponent(options.documentId)}`,
          {
            method: 'DELETE',
          }
        );
        return { results: { success: true } };
      },
      listUsers: async () => {
        throw new Error('v0.1 不提供项目成员管理。');
      },
      removeUser: async () => {
        throw new Error('v0.1 不提供项目成员管理。');
      },
    },
    users: {
      me: async () => {
        const data = await apiRequest<{ user?: SessionUser }>('/api/me');
        const user = data.user ?? { id: '', email: '' };
        return {
          results: {
            id: user.id,
            email: user.email,
            isActive: true,
            isSuperuser: user.role === 'admin',
            createdAt: '',
            updatedAt: '',
            isVerified: true,
            collectionIds: [],
          },
        };
      },
      listCollections: async () => {
        const results = await listProjects();
        return { results, totalEntries: results.length };
      },
    },
    system: {
      settings: async () => {
        await apiRequest<{ user?: SessionUser }>('/api/me');
        return { results: {} };
      },
    },
  };

  return client as unknown as r2rClient;
}

const UserContext = createContext<UserContextProps>({
  pipeline: null,
  setPipeline: () => {},
  selectedModel: 'null',
  setSelectedModel: () => {},
  isAuthenticated: false,
  login: async () => ({ success: false, userRole: 'user' }),
  loginWithToken: async () => ({ success: false, userRole: 'user' }),
  logout: async () => {},
  unsetCredentials: async () => {},
  register: async () => {},
  authState: EMPTY_AUTH_STATE,
  getClient: () => null,
  client: null,
  viewMode: 'admin',
  setViewMode: () => {},
  isSuperUser: () => false,
  createUser: async () => {
    throw new Error('createUser is not implemented in the default context');
  },
  deleteUser: async () => {
    throw new Error('deleteUser is not implemented in the default context');
  },
  updateUser: async () => {
    throw new Error('updateUser is not implemented in the default context');
  },
});

export const useUserContext = () => useContext(UserContext);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [viewMode, setViewMode] = useState<'admin' | 'user'>('admin');

  const [pipeline, setPipeline] = useState<Pipeline | null>(() => {
    if (typeof window !== 'undefined') {
      const storedPipeline = localStorage.getItem('pipeline');
      return storedPipeline ? JSON.parse(storedPipeline) : null;
    }
    return null;
  });

  const [selectedModel, setSelectedModel] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('selectedModel') || '';
    }
    return 'null';
  });

  const [authState, setAuthState] = useState<AuthState>(() => {
    if (typeof window !== 'undefined') {
      const storedAuthState = localStorage.getItem('authState');
      if (storedAuthState) {
        const parsed = JSON.parse(storedAuthState);
        if (isAuthState(parsed)) {
          return parsed;
        }
        console.warn(
          'Invalid authState found in localStorage. Resetting to default.'
        );
      }
    }
    return EMPTY_AUTH_STATE;
  });

  const clientRef = useRef<r2rClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = createSameOriginClient();
  }

  // 供异步回调读取最新登录态，避免 refreshSession 随 authState 变化而重建。
  const authStateRef = useRef(authState);
  authStateRef.current = authState;

  useEffect(() => {
    setIsReady(true);
  }, []);

  const isSuperUser = useCallback(() => {
    return authState.userRole === 'admin' && viewMode === 'admin';
  }, [authState.userRole, viewMode]);

  const persistAuthState = useCallback((state: AuthState) => {
    setAuthState(state);
    if (typeof window !== 'undefined') {
      localStorage.setItem('authState', JSON.stringify(state));
    }
  }, []);

  const clearAuthState = useCallback(() => {
    setAuthState(EMPTY_AUTH_STATE);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('authState');
    }
  }, []);

  /** 以服务端会话为准刷新登录态。 */
  const refreshSession = useCallback(async (): Promise<boolean> => {
    try {
      const data = await apiRequest<{ user?: SessionUser }>('/api/me');
      const user = data.user;
      if (!user?.id) {
        clearAuthState();
        return false;
      }
      persistAuthState({
        isAuthenticated: true,
        email: user.email,
        userRole: user.role === 'admin' ? 'admin' : 'user',
        userId: user.id,
      });
      return true;
    } catch (error) {
      // 只有服务端明确判定未登录时才清除登录态；服务不可用时保留当前状态。
      if (error instanceof SameOriginError && error.status === 401) {
        clearAuthState();
        return false;
      }
      return authStateRef.current.isAuthenticated;
    }
  }, [clearAuthState, persistAuthState]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const login = useCallback(
    async (
      email: string,
      password: string,
      _instanceUrl?: string
    ): Promise<{ success: boolean; userRole: 'admin' | 'user' }> => {
      const data = await apiRequest<{ user?: SessionUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      const user = data.user;
      if (!user?.id) {
        throw new Error('登录失败：服务未返回账号信息。');
      }
      persistAuthState({
        isAuthenticated: true,
        email: user.email,
        userRole: user.role === 'admin' ? 'admin' : 'user',
        userId: user.id,
      });
      return {
        success: true,
        userRole: user.role === 'admin' ? 'admin' : 'user',
      };
    },
    [persistAuthState]
  );

  const loginWithToken = useCallback(async (): Promise<{
    success: boolean;
    userRole: 'admin' | 'user';
  }> => {
    throw new Error('不支持外部令牌登录：本版本仅支持本地单账号。');
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error('Logout request failed:', error);
    }
    clearAuthState();
    if (typeof window !== 'undefined') {
      localStorage.removeItem('pipeline');
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    }
    setPipeline(null);
  }, [clearAuthState]);

  const unsetCredentials = useCallback(async () => {
    clearAuthState();
    if (typeof window !== 'undefined') {
      localStorage.removeItem('pipeline');
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    }
    setPipeline(null);
  }, [clearAuthState]);

  const register = useCallback(async () => {
    throw new Error('注册已关闭：本版本仅支持本地单账号登录。');
  }, []);

  const createUser = useCallback(async () => {
    throw new Error('v0.1 不提供用户管理接口。');
  }, []);

  const deleteUser = useCallback(async () => {
    throw new Error('v0.1 不提供用户管理接口。');
  }, []);

  const updateUser = useCallback(async () => {
    throw new Error('v0.1 不提供用户管理接口。');
  }, []);

  const getClient = useCallback((): r2rClient | null => {
    return clientRef.current;
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('selectedModel', selectedModel);
    }
  }, [selectedModel]);

  // 路由切换与定时刷新都以服务端会话为准，避免浏览器缓存造成的越权视图。
  useEffect(() => {
    const handler = () => {
      void refreshSession();
    };
    router.events?.on('routeChangeComplete', handler);
    const interval = setInterval(handler, 5 * 60 * 1000);
    return () => {
      router.events?.off('routeChangeComplete', handler);
      clearInterval(interval);
    };
  }, [refreshSession, router.events]);

  const contextValue = useMemo(
    () => ({
      pipeline,
      setPipeline,
      selectedModel,
      setSelectedModel,
      isAuthenticated: authState.isAuthenticated,
      authState,
      login,
      loginWithToken,
      logout,
      unsetCredentials,
      register,
      getClient,
      client: clientRef.current,
      viewMode,
      setViewMode,
      isSuperUser,
      createUser,
      deleteUser,
      updateUser,
    }),
    [
      pipeline,
      selectedModel,
      authState,
      login,
      loginWithToken,
      logout,
      unsetCredentials,
      register,
      getClient,
      viewMode,
      isSuperUser,
      createUser,
      deleteUser,
      updateUser,
    ]
  );

  if (!isReady) {
    return null;
  }

  return (
    <UserContext.Provider value={contextValue}>{children}</UserContext.Provider>
  );
};
