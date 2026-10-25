"""Export Qwen3.5's image encoder with explicit per-image preprocessing inputs."""
import torch
from torch.nn import functional as F
from transformers.models.qwen3_5.modeling_qwen3_5 import apply_rotary_pos_emb_vision


class VisionForExport(torch.nn.Module):
    def __init__(self, vision):
        super().__init__()
        self.vision = vision

    def forward(self, pixel_values, position_ids, interp_indices, interp_weights, grid_thw):
        # The browser evaluates each reference separately, then concatenates its features.
        # This keeps image boundaries exact without tracing Python .tolist()/split sizes.
        if not torch.jit.is_tracing():
            if tuple(grid_thw.shape) != (1, 3) or int(grid_thw[0, 0]) != 1:
                raise ValueError('Encode one image per vision call; concatenate reference features afterward.')
            if int(grid_thw.prod()) != pixel_values.shape[0]:
                raise ValueError('Image grid does not match its patch count.')
        v = self.vision
        patch = v.patch_embed.proj
        x = F.linear(pixel_values.to(patch.weight.dtype), patch.weight.flatten(1), patch.bias)
        x = x + (v.pos_embed(interp_indices) * interp_weights.to(x.dtype).unsqueeze(-1)).sum(1)
        cos, sin = v.rotary_pos_emb(x, position_ids)
        for block in v.blocks:
            a = block.attn
            q, k, value = a.qkv(block.norm1(x)).reshape(-1, 3, a.num_heads, a.head_dim).permute(1, 0, 2, 3).unbind(0)
            q, k = apply_rotary_pos_emb_vision(q, k, cos, sin)
            attended = F.scaled_dot_product_attention(
                q.transpose(0, 1).unsqueeze(0), k.transpose(0, 1).unsqueeze(0),
                value.transpose(0, 1).unsqueeze(0), dropout_p=0., is_causal=False, scale=a.scaling)
            x = x + a.proj(attended.transpose(1, 2).reshape(-1, a.dim))
            x = x + block.mlp(block.norm2(x))
        return v.merger(x)
