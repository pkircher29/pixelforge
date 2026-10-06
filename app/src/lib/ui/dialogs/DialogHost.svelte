<script lang="ts">
  import { dialogs } from "./dialogs.svelte";
</script>

{#each dialogs.stack as req (req.id)}
  <req.component {...req.props} resolve={req.resolve} />
{/each}
