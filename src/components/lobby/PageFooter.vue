<template>
  <footer class="page-footer">
    <span class="footer-brand">Bridge Classroom &middot; Free educational tool &middot; Provided as-is</span>
    <nav class="footer-links">
      <a href="https://discord.gg/GqyyU3sVS4" target="_blank" rel="noopener">Discord</a>
      <a href="https://github.com/bridge-craftwork/Bridge-Classroom" target="_blank" rel="noopener">GitHub</a>
    </nav>
  </footer>
</template>

<style scoped>
.page-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
  margin-top: auto;
  border-top: 1px solid var(--card-border, #e0ddd7);
  font-size: 13px;
  color: var(--text-muted, #9ca3af);
}

.footer-brand {
  font-family: var(--font-body, 'DM Sans', sans-serif);
}

.footer-links {
  display: flex;
  gap: 16px;
}

.footer-links a {
  color: var(--text-secondary, #6b7280);
  text-decoration: none;
  transition: color 0.2s;
}

.footer-links a:hover {
  color: var(--green-mid, #40916c);
}

@media (max-width: 600px) {
  .page-footer {
    flex-direction: column;
    gap: 8px;
    text-align: center;
  }
}
</style>
