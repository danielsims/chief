/* The relay's whole use of x264, behind plain types, so Rust never depends on
 * x264's struct layouts (which differ between targets). */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "x264.h"

typedef struct {
    x264_t *encoder;
    x264_param_t param;
    x264_picture_t picture;
} relay_x264;

relay_x264 *relay_x264_open(int width, int height, int fps, int threads, float crf, int max_kbps, int buffer_kbit) {
    relay_x264 *r = calloc(1, sizeof *r);
    if (!r) return NULL;
    x264_param_t *p = &r->param;
    if (x264_param_default_preset(p, "ultrafast", "zerolatency") < 0) goto fail;
    p->i_width = width;
    p->i_height = height;
    p->i_csp = X264_CSP_I420;
    p->i_fps_num = fps;
    p->i_fps_den = 1;
    p->i_timebase_num = 1;
    p->i_timebase_den = 1000;
    p->b_vfr_input = 0;
    p->i_threads = threads;
    p->b_sliced_threads = threads > 1;
    p->i_slice_count = threads;
    /* Keyframes only on request: a viewer joining or catching up asks for one. */
    p->i_keyint_max = X264_KEYINT_MAX_INFINITE;
    p->i_keyint_min = 1;
    p->i_scenecut_threshold = 0;
    p->i_bframe = 0;
    p->b_annexb = 1;
    p->b_repeat_headers = 1;
    p->i_log_level = X264_LOG_WARNING;
    p->rc.i_rc_method = X264_RC_CRF;
    p->rc.f_rf_constant = crf;
    p->rc.i_lookahead = 0;
    p->rc.b_mb_tree = 0;
    p->i_sync_lookahead = 0;
    /* Follows a fast scroll as motion rather than as new pixels. */
    p->analyse.i_me_method = X264_ME_UMH;
    p->analyse.i_me_range = 64;
    /* Damage tells x264 which macroblocks are unchanged. */
    p->analyse.b_mb_info = 1;
    p->rc.i_vbv_max_bitrate = max_kbps;
    p->rc.i_vbv_buffer_size = buffer_kbit;
    /* sRGB pixels in BT.601 limited range, as the relay converts them. */
    p->vui.i_colorprim = 1;
    p->vui.i_transfer = 13;
    p->vui.i_colmatrix = 6;
    p->vui.b_fullrange = 0;
    if (x264_param_apply_profile(p, "high") < 0) goto fail;
    r->encoder = x264_encoder_open(p);
    if (!r->encoder) goto fail;
    x264_picture_init(&r->picture);
    r->picture.img.i_csp = X264_CSP_I420;
    r->picture.img.i_plane = 3;
    return r;
fail:
    free(r);
    return NULL;
}

int relay_x264_rate(relay_x264 *r, float crf, int max_kbps, int buffer_kbit) {
    r->param.rc.f_rf_constant = crf;
    r->param.rc.i_vbv_max_bitrate = max_kbps;
    r->param.rc.i_vbv_buffer_size = buffer_kbit;
    return x264_encoder_reconfig(r->encoder, &r->param);
}

/* Encodes one picture. `mb_info` (one byte per macroblock, X264_MBINFO_CONSTANT
 * on unchanged ones) may be NULL. Returns the Annex-B size and points `out` at
 * it, valid until the next call; negative on error. */
int relay_x264_encode(relay_x264 *r, const uint8_t *y, const uint8_t *u, const uint8_t *v,
                      int stride_y, int stride_uv, int64_t pts, int force_idr, uint8_t *mb_info,
                      const uint8_t **out, int *keyframe) {
    x264_picture_t *pic = &r->picture;
    pic->img.plane[0] = (uint8_t *)y;
    pic->img.plane[1] = (uint8_t *)u;
    pic->img.plane[2] = (uint8_t *)v;
    pic->img.i_stride[0] = stride_y;
    pic->img.i_stride[1] = stride_uv;
    pic->img.i_stride[2] = stride_uv;
    pic->i_type = force_idr ? X264_TYPE_IDR : X264_TYPE_AUTO;
    pic->i_qpplus1 = 0;
    pic->i_pts = pts;
    pic->prop.mb_info = mb_info;
    pic->prop.mb_info_free = NULL;
    x264_nal_t *nals = NULL;
    int count = 0;
    x264_picture_t done;
    int size = x264_encoder_encode(r->encoder, &nals, &count, pic, &done);
    pic->prop.mb_info = NULL;
    if (size < 0) return size;
    /* NAL payloads are contiguous. */
    *out = size > 0 ? nals[0].p_payload : NULL;
    *keyframe = done.b_keyframe;
    return size;
}

void relay_x264_close(relay_x264 *r) {
    if (!r) return;
    x264_encoder_close(r->encoder);
    free(r);
}
