#!/usr/bin/env pwsh
# deploy-subtrees.ps1
# Syncs each sub-app from the monorepo to its individual Vercel-connected GitHub repository.
# Usage: .\deploy-subtrees.ps1
# Usage (force): .\deploy-subtrees.ps1 -Force

param([switch]$Force)

function Push-Subtree {
  param($Prefix, $Remote, $Branch = "main")
  Write-Host ""
  Write-Host ">>> Pushing $Prefix -> $Remote ..." -ForegroundColor Cyan

  if ($Force) {
    # git subtree split generates a commit SHA, then force-push it as the branch ref
    $sha = git subtree split --prefix=$Prefix HEAD
    if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: split failed for $Prefix" -ForegroundColor Red; exit 1 }
    git push $Remote "${sha}:refs/heads/$Branch" --force
  } else {
    git subtree push --prefix=$Prefix $Remote $Branch
  }

  if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: push failed for $Prefix -> $Remote" -ForegroundColor Red; exit 1 }
  Write-Host "OK: $Prefix pushed to $Remote" -ForegroundColor Green
}

Push-Subtree -Prefix "newsops-fe"   -Remote "navi-news"     -Branch "main"
Push-Subtree -Prefix "newsops-next" -Remote "newsops-admin" -Branch "main"

Write-Host ""
Write-Host "All sub-repos updated. Vercel deployments should trigger automatically." -ForegroundColor Green
