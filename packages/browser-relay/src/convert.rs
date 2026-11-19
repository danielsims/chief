//! Captured BGRX rows to I420 (BT.601, limited range) for the encoder, split
//! across threads by row band. Same arithmetic as libyuv's ARGBToI420.

pub struct I420 {
    pub width: usize,
    pub y: Vec<u8>,
    pub u: Vec<u8>,
    pub v: Vec<u8>,
}

impl I420 {
    pub fn new(width: usize, height: usize) -> Self {
        let chroma = width.div_ceil(2) * height.div_ceil(2);
        I420 {
            width,
            y: vec![16; width * height],
            u: vec![128; chroma],
            v: vec![128; chroma],
        }
    }

    pub fn stride_uv(&self) -> usize {
        self.width.div_ceil(2)
    }
}

fn luma_row(src: &[u8], out: &mut [u8]) {
    for (y, px) in out.iter_mut().zip(src.chunks_exact(4)) {
        let (b, g, r) = (px[0] as i32, px[1] as i32, px[2] as i32);
        *y = ((66 * r + 129 * g + 25 * b + 0x1080) >> 8) as u8;
    }
}

/// One or two source rows: their luma, and one chroma row from 2x2 averages.
/// A missing second row or last odd column repeats its neighbour.
fn convert_pair(top: &[u8], bottom: &[u8], luma: &mut [u8], u: &mut [u8], v: &mut [u8], width: usize) {
    let (luma_top, luma_bottom) = luma.split_at_mut(width.min(luma.len()));
    luma_row(top, luma_top);
    if !luma_bottom.is_empty() {
        luma_row(bottom, luma_bottom);
    }
    for (cx, (u, v)) in u.iter_mut().zip(v.iter_mut()).enumerate() {
        let a = cx * 8;
        let b = if cx * 2 + 1 < width { a + 4 } else { a };
        let sum = |i: usize| top[a + i] as i32 + top[b + i] as i32 + bottom[a + i] as i32 + bottom[b + i] as i32;
        let (bl, gr, rd) = ((sum(0) + 2) >> 2, (sum(1) + 2) >> 2, (sum(2) + 2) >> 2);
        *u = ((112 * bl - 74 * gr - 38 * rd + 0x8080) >> 8) as u8;
        *v = ((112 * rd - 94 * gr - 18 * bl + 0x8080) >> 8) as u8;
    }
}

/// Converts rows [y0, y1) of `src` into `dst` on up to `threads` threads. `y0` is even.
pub fn convert_band(src: &[u8], src_stride: usize, dst: &mut I420, y0: usize, y1: usize, threads: usize) {
    if y1 <= y0 {
        return;
    }
    assert!(y0 % 2 == 0, "bands start on an even row");
    let width = dst.width;
    assert!(src.len() >= (y1 - 1) * src_stride + width * 4, "capture smaller than the band");
    let stride_uv = dst.stride_uv();
    let rows = y1 - y0;
    let pairs = rows.div_ceil(2);
    let src = &src[y0 * src_stride..];
    let mut luma = &mut dst.y[y0 * width..y1 * width];
    let mut u = &mut dst.u[(y0 / 2) * stride_uv..(y0 / 2 + pairs) * stride_uv];
    let mut v = &mut dst.v[(y0 / 2) * stride_uv..(y0 / 2 + pairs) * stride_uv];
    // Bands of at least 32 row pairs, so threads are worth starting.
    let parts = threads.clamp(1, (pairs / 32).max(1));
    let per = pairs.div_ceil(parts);
    std::thread::scope(|scope| {
        let mut first = 0;
        while first < pairs {
            let count = per.min(pairs - first);
            let band_rows = (count * 2).min(rows - first * 2);
            let (luma_part, luma_rest) = std::mem::take(&mut luma).split_at_mut(band_rows * width);
            let (u_part, u_rest) = std::mem::take(&mut u).split_at_mut(count * stride_uv);
            let (v_part, v_rest) = std::mem::take(&mut v).split_at_mut(count * stride_uv);
            (luma, u, v) = (luma_rest, u_rest, v_rest);
            let src = &src[first * 2 * src_stride..];
            let mut job = move || {
                for p in 0..count {
                    let top = &src[p * 2 * src_stride..][..width * 4];
                    let two = band_rows - p * 2 >= 2;
                    let bottom = if two { &src[(p * 2 + 1) * src_stride..][..width * 4] } else { top };
                    let luma_rows = &mut luma_part[p * 2 * width..(p * 2 + if two { 2 } else { 1 }) * width];
                    convert_pair(
                        top,
                        bottom,
                        luma_rows,
                        &mut u_part[p * stride_uv..(p + 1) * stride_uv],
                        &mut v_part[p * stride_uv..(p + 1) * stride_uv],
                        width,
                    );
                }
            };
            if first + count >= pairs {
                job();
            } else {
                scope.spawn(job);
            }
            first += count;
        }
    });
}
