(function (global) {
  const FIREBASE_VERSION = '11.10.0';
  const BLOB_CLIENT_URL = 'https://esm.sh/@vercel/blob@2.9.0/client?bundle';

  function createCloudflarePortfolioClient(config) {
    let apiOrigin;
    try {
      const apiUrl = new URL(config.cloudflareApiUrl);
      if (apiUrl.protocol !== 'https:' || apiUrl.username || apiUrl.password) {
        throw new Error();
      }
      apiOrigin = apiUrl.origin;
    } catch {
      throw new Error('The Cloudflare API URL must be a valid HTTPS origin.');
    }

    let firebaseAuth = null;
    let firebaseLoadPromise = null;
    let firebaseReadyPromise = null;
    let firebaseUser = null;
    let blobClientPromise = null;
    let adminVerified = false;

    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Could not load Firebase Authentication.'));
        document.head.appendChild(script);
      });
    }

    async function getFirebaseAuth() {
      if (!firebaseLoadPromise) {
        firebaseLoadPromise = (async () => {
          if (!config.firebase || !config.firebase.apiKey || !config.firebase.projectId) {
            throw new Error('Firebase web-app configuration is missing.');
          }
          const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
          if (!global.firebase) await loadScript(`${base}/firebase-app-compat.js`);
          if (!global.firebase || !global.firebase.auth) {
            await loadScript(`${base}/firebase-auth-compat.js`);
          }
          if (!global.firebase || !global.firebase.auth) {
            throw new Error('Firebase Authentication could not be initialized.');
          }
          const app = global.firebase.apps.length
            ? global.firebase.app()
            : global.firebase.initializeApp(config.firebase);
          firebaseAuth = app.auth();
          firebaseReadyPromise = new Promise((resolve, reject) => {
            let unsubscribe = () => {};
            unsubscribe = firebaseAuth.onAuthStateChanged(
              user => {
                firebaseUser = user;
                unsubscribe();
                resolve();
              },
              error => {
                unsubscribe();
                reject(error);
              }
            );
          });
          return firebaseAuth;
        })().catch(error => {
          firebaseLoadPromise = null;
          firebaseAuth = null;
          throw error;
        });
      }
      return firebaseLoadPromise;
    }

    async function initializeAuth() {
      const auth = await getFirebaseAuth();
      await firebaseReadyPromise;
      return auth;
    }

    function normalizeUser(user) {
      if (!user) return null;
      return {
        id: user.uid,
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified
      };
    }

    function normalizeSession(user) {
      return user ? { user: normalizeUser(user) } : null;
    }

    async function getIdToken() {
      const auth = await initializeAuth();
      const user = auth.currentUser || firebaseUser;
      if (!user) throw new Error('Sign in to manage the portfolio.');
      return user.getIdToken();
    }

    async function request(url, options) {
      const response = await fetch(url, options);
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error('The backend returned an invalid response.');
        }
      }
      if (!response.ok) {
        const error = new Error(data && data.error ? data.error : 'The backend request failed.');
        error.status = response.status;
        throw error;
      }
      return data;
    }

    async function workerRequest(path, options) {
      const requestOptions = {
        method: options && options.method ? options.method : 'GET',
        headers: new Headers()
      };
      if (options && options.auth) {
        requestOptions.headers.set('authorization', `Bearer ${await getIdToken()}`);
      }
      if (options && options.body !== undefined) {
        requestOptions.headers.set('content-type', 'application/json');
        requestOptions.body = JSON.stringify(options.body);
      }
      return request(new URL(path, `${apiOrigin}/`), requestOptions);
    }

    async function vercelRequest(path, options) {
      const requestOptions = {
        method: options.method,
        headers: new Headers({ authorization: `Bearer ${await getIdToken()}` })
      };
      if (options.body !== undefined) {
        requestOptions.headers.set('content-type', 'application/json');
        requestOptions.body = JSON.stringify(options.body);
      }
      return request(path, requestOptions);
    }

    async function getRows(table) {
      if (table === 'projects') {
        const path = adminVerified ? '/api/admin/projects' : '/api/projects';
        return await workerRequest(path, { auth: adminVerified });
      }
      if (table === 'portfolio_disciplines') {
        return workerRequest('/api/disciplines');
      }
      if (table === 'portfolio_settings') {
        const settings = await workerRequest('/api/settings');
        return settings ? [settings] : [];
      }
      if (table === 'portfolio_admins') {
        const identity = await workerRequest('/api/admin/me', { auth: true });
        return [{ user_id: identity.id, email: identity.email }];
      }
      throw new Error(`Unsupported portfolio data table: ${table}.`);
    }

    async function writeRecord(table, action, payload, filters) {
      const idFilter = filters.find(filter => filter.column === 'id');
      if (table === 'projects') {
        if (action === 'insert') {
          return workerRequest('/api/admin/projects', { method: 'POST', auth: true, body: payload });
        }
        if (action === 'update' && idFilter) {
          return workerRequest(`/api/admin/projects/${encodeURIComponent(idFilter.value)}`, {
            method: 'PATCH',
            auth: true,
            body: payload
          });
        }
        if (action === 'delete' && idFilter) {
          return vercelRequest('/api/project', {
            method: 'DELETE',
            body: { projectId: idFilter.value }
          });
        }
      }
      if (table === 'portfolio_disciplines') {
        if (action === 'insert') {
          return workerRequest('/api/admin/disciplines', { method: 'POST', auth: true, body: payload });
        }
        if (action === 'update' && idFilter) {
          return workerRequest(`/api/admin/disciplines/${encodeURIComponent(idFilter.value)}`, {
            method: 'PATCH',
            auth: true,
            body: payload
          });
        }
        if (action === 'delete' && idFilter) {
          return workerRequest(`/api/admin/disciplines/${encodeURIComponent(idFilter.value)}`, {
            method: 'DELETE',
            auth: true
          });
        }
      }
      if (table === 'portfolio_settings' && action === 'update') {
        const settings = { ...payload };
        delete settings.updated_at;
        return workerRequest('/api/admin/settings', {
          method: 'PATCH',
          auth: true,
          body: settings
        });
      }
      throw new Error(`Unsupported ${action} operation for ${table}.`);
    }

    class PortfolioQuery {
      constructor(table) {
        this.table = table;
        this.action = 'select';
        this.payload = null;
        this.filters = [];
        this.countRequested = false;
        this.singleResult = false;
        this.execution = null;
      }

      select(columns, options) {
        if (this.action === 'select' && options && options.count === 'exact') {
          this.countRequested = true;
        }
        return this;
      }

      order() {
        return this;
      }

      eq(column, value) {
        this.filters.push({ column, value });
        return this;
      }

      insert(payload) {
        this.action = 'insert';
        this.payload = payload;
        return this;
      }

      update(payload) {
        this.action = 'update';
        this.payload = payload;
        return this;
      }

      delete() {
        this.action = 'delete';
        return this;
      }

      maybeSingle() {
        this.singleResult = true;
        return this.execute();
      }

      then(resolve, reject) {
        return this.execute().then(resolve, reject);
      }

      execute() {
        if (!this.execution) this.execution = this.run();
        return this.execution;
      }

      async run() {
        try {
          if (this.action !== 'select') {
            const data = await writeRecord(this.table, this.action, this.payload, this.filters);
            return { data, error: null };
          }

          let rows = await getRows(this.table);
          if (!Array.isArray(rows)) rows = [];
          rows = rows.filter(row => this.filters.every(({ column, value }) => {
            if (this.table === 'portfolio_settings' && column === 'id') return true;
            return row[column] === value;
          }));

          if (this.countRequested) return { data: null, count: rows.length, error: null };
          if (this.singleResult) {
            if (rows.length > 1) throw new Error('Expected at most one backend record.');
            return { data: rows[0] || null, error: null };
          }
          return { data: rows, error: null };
        } catch (error) {
          return { data: null, error };
        }
      }
    }

    async function uploadBlob(path, file, options) {
      if (!blobClientPromise) {
        blobClientPromise = import(BLOB_CLIENT_URL).then(module => {
          if (typeof module.upload !== 'function') {
            throw new Error('The Vercel Blob browser uploader is unavailable.');
          }
          return module.upload;
        }).catch(error => {
          blobClientPromise = null;
          throw error;
        });
      }
      const upload = await blobClientPromise;
      const token = await getIdToken();
      return upload(path, file, {
        access: 'public',
        contentType: options.contentType,
        handleUploadUrl: '/api/media',
        clientPayload: JSON.stringify({
          firebaseIdToken: token,
          kind: 'image',
          contentType: options.contentType
        })
      });
    }

    const storage = {
      from() {
        return {
          getPublicUrl(path) {
            return { data: { publicUrl: String(path || '') } };
          },
          async upload(path, file, options) {
            try {
              const blob = await uploadBlob(path, file, options || {});
              return { data: { path: blob.url }, error: null };
            } catch (error) {
              return { data: null, error };
            }
          },
          async remove(paths) {
            try {
              for (const path of paths || []) {
                if (!path) continue;
                await vercelRequest('/api/media', {
                  method: 'DELETE',
                  body: { url: path }
                });
              }
              return { data: paths || [], error: null };
            } catch (error) {
              return { data: null, error };
            }
          }
        };
      }
    };

    const auth = {
      initialize: initializeAuth,
      async onAuthStateChange(callback) {
        let unsubscribe = () => {};
        let skipInitial = true;
        try {
          const instance = await getFirebaseAuth();
          unsubscribe = instance.onAuthStateChanged(user => {
            firebaseUser = user;
            if (skipInitial) {
              skipInitial = false;
              return;
            }
            callback(user ? 'SIGNED_IN' : 'SIGNED_OUT', normalizeSession(user));
          });
        } catch (error) {
          console.error('Could not observe Firebase authentication changes:', error);
        }
        return { data: { subscription: { unsubscribe } } };
      },
      async signInWithPassword({ email, password }) {
        try {
          const instance = await initializeAuth();
          const credential = await instance.signInWithEmailAndPassword(email, password);
          firebaseUser = credential.user;
          return { data: { user: normalizeUser(credential.user), session: normalizeSession(credential.user) }, error: null };
        } catch (error) {
          return { data: { user: null, session: null }, error };
        }
      },
      async createUserWithPassword({ email, password }) {
        let instance;
        try {
          instance = await initializeAuth();
          const credential = await instance.createUserWithEmailAndPassword(email, password);
          firebaseUser = credential.user;
          await credential.user.sendEmailVerification();
          await instance.signOut();
          firebaseUser = null;
          adminVerified = false;
          return { data: { user: normalizeUser(credential.user) }, error: null };
        } catch (error) {
          if (instance && instance.currentUser) {
            try {
              await instance.signOut();
              firebaseUser = null;
              adminVerified = false;
            } catch (signOutError) {
              error = new Error(`${error.message} The new sign-in session could not be cleared: ${signOutError.message}`);
            }
          }
          return { data: null, error };
        }
      },
      async signOut() {
        try {
          const instance = await initializeAuth();
          await instance.signOut();
          firebaseUser = null;
          adminVerified = false;
          return { error: null };
        } catch (error) {
          return { error };
        }
      },
      async getSession() {
        try {
          const instance = await initializeAuth();
          const session = normalizeSession(instance.currentUser || firebaseUser);
          return { data: { session }, error: null };
        } catch (error) {
          return { data: { session: null }, error };
        }
      },
      async resetPasswordForEmail(email, options) {
        try {
          const instance = await initializeAuth();
          const url = options && options.redirectTo ? options.redirectTo : config.siteUrl;
          await instance.sendPasswordResetEmail(email, { url });
          return { error: null };
        } catch (error) {
          return { error };
        }
      },
      async confirmPasswordReset(code, password) {
        try {
          const instance = await initializeAuth();
          await instance.confirmPasswordReset(code, password);
          return { error: null };
        } catch (error) {
          return { error };
        }
      },
      async updateUser(updates) {
        try {
          const instance = await initializeAuth();
          const user = instance.currentUser;
          if (!user) throw new Error('Sign in again before changing your account settings.');
          if (updates.email) {
            await user.verifyBeforeUpdateEmail(updates.email);
            return { data: { user: { new_email: updates.email } }, error: null };
          }
          if (updates.password) {
            await user.updatePassword(updates.password);
            return { data: { user: normalizeUser(user) }, error: null };
          }
          throw new Error('No supported account update was provided.');
        } catch (error) {
          return { data: null, error };
        }
      }
    };

    return {
      auth,
      storage,
      from(table) {
        return new PortfolioQuery(table);
      },
      setAdmin(value) {
        adminVerified = value === true;
      }
    };
  }

  global.createCloudflarePortfolioClient = createCloudflarePortfolioClient;
})(window);
