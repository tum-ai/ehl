// Opt-in preload for the existing local lifecycle suite and its Next process.
// Blocks external global fetch calls, including dispatch via database settings.
// It is not a general socket firewall: also blank external service credentials.
if (process.env.SUPABASE_TEST_MODE !== 'true') throw new Error('Demo network guard requires test mode');
const allowed = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin;
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  // Deterministic source objects for the existing submission walkthrough.
  // Only synthetic e2e-source repos are handled; every other external request
  // stays blocked. Worker quota responses are mocked inside its lifecycle test.
  if (url.origin === 'https://api.github.com') {
    const source = url.pathname.match(/^\/repos\/e2e-source\/(project-(\d+)|entire-missing|entire-valid|entire-limited)(.*)$/);
    if (source) {
      const [, name, id, path] = source;
      if (name === 'entire-limited') return Promise.resolve(Response.json({message:'API rate limit exceeded'}, {status:429}));
      if (!path) return Promise.resolve(Response.json({id:Number(id || 1000), private:false, default_branch:'main'}));
      if (path === '/git/ref/heads/main') return Promise.resolve(Response.json({object:{sha:'a'.repeat(40)}}));
      if (path === '/git/matching-refs/') return Promise.resolve(Response.json(name === 'entire-missing' ? [] : [{ref:'refs/entire/checkpoints/ab/123',object:{sha:'b'.repeat(40)}}]));
      if (path === `/git/trees/${'b'.repeat(40)}`) return Promise.resolve(Response.json({truncated:false, tree:[{path:'ab/123/prompt.txt',type:'blob',sha:'c'.repeat(40)}]}));
      if (path === `/git/blobs/${'c'.repeat(40)}`) return Promise.resolve(Response.json({encoding:'base64',content:Buffer.from('Build the E2E project').toString('base64')}));
    }
  }
  if (url.origin !== allowed && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    return Promise.reject(new Error('External HTTP blocked by local submission demo'));
  }
  return originalFetch(input, init);
};
