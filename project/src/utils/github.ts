import { Octokit } from 'octokit';
import JSZip from 'jszip';
import { RateLimiter } from './rateLimiter';

const rateLimiter = new RateLimiter({
  maxRequests: 5000,
  perMinute: 60,
});

export async function createGitHubRepo(
  token: string,
  repoData: {
    name: string;
    description: string;
    isPrivate: boolean;
    initReadme: boolean;
  }
) {
  if (!token) {
    throw new Error('GitHub token is required');
  }

  const octokit = new Octokit({ auth: token });

  try {
    const response = await octokit.repos.createForAuthenticatedUser({
      name: repoData.name,
      description: repoData.description,
      private: repoData.isPrivate,
      auto_init: repoData.initReadme,
    });

    return response.data;
  } catch (error: any) {
    console.error('Error creating repository:', error);
    if (error.status === 422) {
      throw new Error('Repository name already exists or is invalid');
    }
    throw new Error(error.message || 'Failed to create repository');
  }
}

export async function uploadToGitHub(
  token: string,
  repoName: string,
  zipFile: File
): Promise<void> {
  if (!token) {
    throw new Error('GitHub token is required');
  }

  const octokit = new Octokit({ auth: token });
  
  try {
    // Wait for repository to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    const zip = await JSZip.loadAsync(zipFile);
    const { data: user } = await octokit.users.getAuthenticated();

    for (const [path, file] of Object.entries(zip.files)) {
      if (file.dir) continue;

      try {
        await rateLimiter.waitForToken();

        const content = await file.async('base64');
        
        try {
          // Try to get existing file
          const { data: existingFile } = await octokit.repos.getContent({
            owner: user.login,
            repo: repoName,
            path,
          });

          // Update existing file
          await octokit.repos.createOrUpdateFileContents({
            owner: user.login,
            repo: repoName,
            path,
            message: `Update ${path}`,
            content,
            sha: (existingFile as any).sha,
          });
        } catch (e) {
          // File doesn't exist, create new file
          await octokit.repos.createOrUpdateFileContents({
            owner: user.login,
            repo: repoName,
            path,
            message: `Add ${path}`,
            content,
          });
        }
      } catch (error: any) {
        console.error(`Error uploading ${path}:`, error);
        throw new Error(`Failed to upload ${path}: ${error.message}`);
      }
    }
  } catch (error: any) {
    console.error('Error processing ZIP file:', error);
    throw new Error(error.message || 'Failed to process ZIP file');
  }
}