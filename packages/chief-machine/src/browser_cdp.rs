//! Private CDP connection to a Chrome process owned by this host. No HTTP
//! service, arbitrary endpoint, script, path or CDP method is exposed remotely.
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use tokio::net::TcpStream;
use tokio_tungstenite::{tungstenite::Message, MaybeTlsStream, WebSocketStream};

pub struct Cdp {
    socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
    sequence: u64,
    session: String,
    refs: HashMap<String, u64>,
    names: HashMap<String, String>,
}
impl Cdp {
    pub async fn connect(endpoint: &str) -> Result<Self, String> {
        let mut config = tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default();
        config.max_message_size = Some(4_000_000);
        config.max_frame_size = Some(4_000_000);
        let (socket, _) =
            tokio_tungstenite::connect_async_with_config(endpoint, Some(config), false)
                .await
                .map_err(|_| "Cannot connect to owned Chrome.")?;
        let mut cdp = Self {
            socket,
            sequence: 0,
            session: String::new(),
            refs: HashMap::new(),
            names: HashMap::new(),
        };
        let target = cdp
            .call("Target.createTarget", json!({"url":"about:blank"}), false)
            .await?;
        let target = target["targetId"]
            .as_str()
            .ok_or("Missing owned Chrome target.")?;
        let attached = cdp
            .call(
                "Target.attachToTarget",
                json!({"targetId":target,"flatten":true}),
                false,
            )
            .await?;
        cdp.session = attached["sessionId"]
            .as_str()
            .ok_or("Cannot attach owned target.")?
            .into();
        cdp.call("Page.enable", json!({}), true).await?;
        cdp.call("Accessibility.enable", json!({}), true).await?;
        cdp.call(
            "Browser.setDownloadBehavior",
            json!({"behavior":"deny"}),
            false,
        )
        .await?;
        // Fixed host script; no caller can supply JavaScript. Disable browser
        // peer networking in attached-target documents before page scripts execute.
        // Network containment remains independent for workers/popups.
        cdp.call("Page.addScriptToEvaluateOnNewDocument",json!({"source":"Object.defineProperty(globalThis,'RTCPeerConnection',{value:undefined});Object.defineProperty(globalThis,'webkitRTCPeerConnection',{value:undefined});"}),true).await?;
        Ok(cdp)
    }
    async fn call(&mut self, method: &str, params: Value, page: bool) -> Result<Value, String> {
        self.sequence += 1;
        let id = self.sequence;
        let mut command = json!({"id":id,"method":method,"params":params});
        if page {
            command["sessionId"] = json!(self.session);
        }
        self.socket
            .send(Message::text(command.to_string()))
            .await
            .map_err(|_| "Owned Chrome command failed.")?;
        loop {
            let message = self
                .socket
                .next()
                .await
                .ok_or("Owned Chrome disconnected.")?
                .map_err(|_| "Owned Chrome transport failed.")?;
            if let Message::Text(text) = message {
                let value: Value = serde_json::from_str(text.as_str())
                    .map_err(|_| "Invalid owned Chrome response.")?;
                if value.get("id").and_then(Value::as_u64) != Some(id) {
                    continue;
                }
                if value.get("error").is_some() {
                    return Err(
                        "Chrome refused the browser operation. Take a fresh snapshot.".into(),
                    );
                }
                return value
                    .get("result")
                    .cloned()
                    .ok_or("Missing Chrome operation result.".into());
            }
        }
    }
    pub async fn navigate(&mut self, url: &str) -> Result<(), String> {
        let result = self.call("Page.navigate", json!({"url":url}), true).await?;
        if result.get("errorText").is_some() {
            return Err("Chrome could not load this public page.".into());
        }
        self.refs.clear();
        self.names.clear();
        // Short readiness window; callers can snapshot again while a page loads.
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        Ok(())
    }
    pub async fn snapshot(&mut self) -> Result<Value, String> {
        let tree = self.call("Page.getFrameTree", json!({}), true).await?;
        let frame = &tree["frameTree"]["frame"];
        let url = frame["url"].as_str().ok_or("Missing browser page URL.")?;
        if url != "about:blank" {
            crate::browser_proxy::destination(url)?;
        }
        let ax = self
            .call("Accessibility.getFullAXTree", json!({}), true)
            .await?;
        let nodes = ax["nodes"]
            .as_array()
            .ok_or("Missing accessibility tree.")?;
        self.refs.clear();
        self.names.clear();
        let mut lines = Vec::new();
        let mut controls = Vec::new();
        let mut total = 0;
        let mut title = String::new();
        for node in nodes.iter().take(3000) {
            if node["ignored"] == true {
                continue;
            }
            let role = node["role"]["value"].as_str().unwrap_or("");
            let name = node["name"]["value"].as_str().unwrap_or("");
            if role == "RootWebArea" {
                title = name.chars().take(1000).collect();
            }
            if name.is_empty() || role == "InlineTextBox" {
                continue;
            }
            let mut line = format!("- {role} {}", name.chars().take(500).collect::<String>());
            if let Some(backend) = node["backendDOMNodeId"].as_u64() {
                if [
                    "link",
                    "button",
                    "textbox",
                    "combobox",
                    "checkbox",
                    "radio",
                    "searchbox",
                    "menuitem",
                    "option",
                    "tab",
                    "slider",
                ]
                .contains(&role)
                {
                    let reference = format!("e{}", self.refs.len() + 1);
                    self.refs.insert(reference.clone(), backend);
                    self.names.entry(name.into()).or_insert(reference.clone());
                    line.push_str(&format!(" [ref={reference}]"));
                    if controls.len() < 100 {
                        controls.push(line.clone());
                    }
                }
            }
            total += line.len();
            if total > 40_000 {
                break;
            }
            lines.push(line);
        }
        Ok(json!({"url":url,"title":title,"text":lines.join("\n"),"controls":controls}))
    }
    fn backend(&self, target: &super::browser::Target) -> Result<u64, String> {
        let reference = target
            .reference
            .as_deref()
            .map(|v| v.trim_start_matches('@'))
            .or_else(|| {
                target.labels.as_ref().and_then(|labels| {
                    labels
                        .iter()
                        .find_map(|name| self.names.get(name).map(String::as_str))
                })
            })
            .ok_or("Use a reference from the current snapshot.")?;
        self.refs
            .get(reference)
            .copied()
            .ok_or("Element reference is stale. Take a new snapshot.".into())
    }
    pub async fn click(&mut self, target: &super::browser::Target) -> Result<(), String> {
        let backend = self.backend(target)?;
        self.call(
            "DOM.scrollIntoViewIfNeeded",
            json!({"backendNodeId":backend}),
            true,
        )
        .await?;
        let model = self
            .call("DOM.getBoxModel", json!({"backendNodeId":backend}), true)
            .await?;
        let quad = model["model"]["content"]
            .as_array()
            .ok_or("Element has no visible bounds.")?;
        if quad.len() != 8 {
            return Err("Invalid element bounds.".into());
        }
        let x = (quad[0].as_f64().ok_or("Invalid bounds.")?
            + quad[4].as_f64().ok_or("Invalid bounds.")?)
            / 2.;
        let y = (quad[1].as_f64().ok_or("Invalid bounds.")?
            + quad[5].as_f64().ok_or("Invalid bounds.")?)
            / 2.;
        for kind in ["mousePressed", "mouseReleased"] {
            self.call(
                "Input.dispatchMouseEvent",
                json!({"type":kind,"x":x,"y":y,"button":"left","clickCount":1}),
                true,
            )
            .await?;
        }
        Ok(())
    }
    pub async fn fill(
        &mut self,
        target: &super::browser::Target,
        text: &str,
    ) -> Result<(), String> {
        let backend = self.backend(target)?;
        self.call("DOM.focus", json!({"backendNodeId":backend}), true)
            .await?;
        // Fixed command rather than interpreting caller text as keyboard shortcuts.
        self.call(
            "Input.dispatchKeyEvent",
            json!({"type":"keyDown","key":"a","code":"KeyA","commands":["selectAll"]}),
            true,
        )
        .await?;
        self.call(
            "Input.dispatchKeyEvent",
            json!({"type":"keyUp","key":"a","code":"KeyA"}),
            true,
        )
        .await?;
        self.call("Input.insertText", json!({"text":text}), true)
            .await?;
        Ok(())
    }
    pub async fn select(
        &mut self,
        target: &super::browser::Target,
        values: &[String],
    ) -> Result<(), String> {
        let backend = self.backend(target)?;
        let resolved = self
            .call("DOM.resolveNode", json!({"backendNodeId":backend}), true)
            .await?;
        let object = resolved["object"]["objectId"]
            .as_str()
            .ok_or("Element is no longer available.")?;
        let result=self.call("Runtime.callFunctionOn",json!({"objectId":object,"functionDeclaration":"function(values){if(this.tagName!=='SELECT')return false;for(const option of this.options)option.selected=values.includes(option.value)||values.includes(option.label);this.dispatchEvent(new Event('input',{bubbles:true}));this.dispatchEvent(new Event('change',{bubbles:true}));return true;}","arguments":[{"value":values}],"returnByValue":true}),true).await?;
        if result["result"]["value"] != true {
            return Err("Element is not a select control.".into());
        }
        Ok(())
    }
    pub async fn screenshot(&mut self) -> Result<Value, String> {
        let result = self
            .call(
                "Page.captureScreenshot",
                json!({"format":"png","captureBeyondViewport":false}),
                true,
            )
            .await?;
        let data = result["data"].as_str().ok_or("Screenshot unavailable.")?;
        if data.len() > 866_668 {
            return Err("Screenshot exceeds the transfer limit.".into());
        }
        Ok(json!({"base64":data}))
    }
    #[cfg(test)]
    pub async fn test_script(&mut self, script: &str) -> Result<Value, String> {
        let result = self
            .call(
                "Runtime.evaluate",
                json!({"expression":script,"returnByValue":true}),
                true,
            )
            .await?;
        if result.get("exceptionDetails").is_some() {
            return Err("Test script failed in owned Chrome.".into());
        }
        Ok(result["result"]["value"].clone())
    }
}
