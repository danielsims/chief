//! Framing between chief-machine and a session host's relay, over a Unix
//! socket in the session's private directory: one connection per viewer,
//! opened with a role byte, then frames of kind, length and payload.

use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const ROLE_CONTROL: u8 = b'c';
pub const ROLE_WATCH: u8 = b'w';
pub const BINARY: u8 = 1;
pub const TEXT: u8 = 2;
/// Larger than any keyframe the relay sends; anything bigger is a fault.
const MAX_FRAME: usize = 16 << 20;

pub async fn write<W: AsyncWriteExt + Unpin>(out: &mut W, kind: u8, payload: &[u8]) -> std::io::Result<()> {
    let mut header = [0u8; 5];
    header[0] = kind;
    header[1..].copy_from_slice(&(payload.len() as u32).to_be_bytes());
    out.write_all(&header).await?;
    out.write_all(payload).await
}

pub async fn read<R: AsyncReadExt + Unpin>(input: &mut R) -> std::io::Result<(u8, Vec<u8>)> {
    let mut header = [0u8; 5];
    input.read_exact(&mut header).await?;
    let length = u32::from_be_bytes([header[1], header[2], header[3], header[4]]) as usize;
    if length > MAX_FRAME || !matches!(header[0], BINARY | TEXT) {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "bad media frame"));
    }
    let mut payload = vec![0u8; length];
    input.read_exact(&mut payload).await?;
    Ok((header[0], payload))
}

/// Reads whole frames on their own task, so a reader waiting in `select!`
/// alongside other work never drops a frame half read. Ends with the first
/// error, which is what the receiver gets last.
pub fn frames<R>(mut input: R) -> tokio::sync::mpsc::Receiver<std::io::Result<(u8, Vec<u8>)>>
where
    R: AsyncReadExt + Unpin + Send + 'static,
{
    let (sender, receiver) = tokio::sync::mpsc::channel(64);
    tokio::spawn(async move {
        loop {
            let frame = read(&mut input).await;
            let failed = frame.is_err();
            if sender.send(frame).await.is_err() || failed {
                break;
            }
        }
    });
    receiver
}
