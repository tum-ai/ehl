import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareSubmissionRepositories } from "@/lib/submission-snapshots/prepare";
const mocks = vi.hoisted(() => ({ check: vi.fn(), invite: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getSettingValue: mocks.settings, SETTING_KEYS: {} }));
vi.mock("@/lib/github", () => ({ acceptPendingInvite: mocks.invite }));
vi.mock("@/lib/entire", async original => ({ ...await original<typeof import("@/lib/entire")>(), checkCheckpointBranch: mocks.check }));
const sha="a".repeat(40), checkpoint="b".repeat(40);
const requirements={entire_required:true,submission_fields:[{key:"repo",label:"Repository",type:"repo" as const,required:true}],revision:0};
const refs=[{ref:"refs/entire/checkpoints/ab/123",object:{sha:checkpoint}}];
const fetchMock=vi.fn(async(input: string|URL|Request) => {
  const url=String(input);
  if(url.endsWith('/git/matching-refs/'))return Response.json(refs);
  if(url.endsWith('/git/ref/heads/main'))return Response.json({object:{sha}});
  return Response.json({id:42,default_branch:"main",private:false});
});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('GITHUB_TOKEN','test-only-bot');vi.stubGlobal('fetch',fetchMock);mocks.check.mockResolvedValue({satisfiesGate:true});});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('selects exact code and checkpoint objects before any copying',async()=>{
  const result=await prepareSubmissionRepositories({repo:'https://github.com/example/project'},requirements);
  expect(result).toEqual({repo:{repo_url:'https://github.com/example/project',repository_id:42,frozen_sha:sha,entire_required:true,checkpoint_manifest:[{ref:refs[0].ref,sha:checkpoint}]}});
  expect(mocks.check).toHaveBeenCalledWith('example','project',{token:'test-only-bot',checkpointRefs:[{ref:refs[0].ref,sha:checkpoint}]});
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(mocks.settings).not.toHaveBeenCalled();
});
it('does not inspect Entire for a challenge that does not require it',async()=>{
  const result=await prepareSubmissionRepositories({repo:'https://github.com/example/project'},{...requirements,entire_required:false});
  expect(result.repo.checkpoint_manifest).toEqual([]);expect(mocks.check).not.toHaveBeenCalled();expect(fetchMock).toHaveBeenCalledTimes(2);
});
it.each([{checkUnavailable:false,repoUnreadable:false,reason:'entire_missing'},{checkUnavailable:true,repoUnreadable:false,reason:'entire_check_unavailable'},{checkUnavailable:false,repoUnreadable:true,reason:'entire_repo_unreadable'}])('blocks $reason',async state=>{
  mocks.check.mockResolvedValue({...state,satisfiesGate:false});
  await expect(prepareSubmissionRepositories({repo:'https://github.com/example/project'},requirements)).rejects.toHaveProperty('reason',state.reason);
});
it('blocks a quota error without inventing missing Entire evidence',async()=>{
  fetchMock.mockResolvedValueOnce(Response.json({message:'rate limit'},{status:429}));
  await expect(prepareSubmissionRepositories({repo:'https://github.com/example/project'},requirements)).rejects.toMatchObject({reason:'entire_check_unavailable'});
  expect(mocks.check).not.toHaveBeenCalled();
});
