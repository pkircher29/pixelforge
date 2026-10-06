//! The [`ImageProvider`] trait every hosted backend implements.

use async_trait::async_trait;

use crate::error::Error;
use crate::types::{
    Capabilities, EditMode, EditRequest, GenerateRequest, ImageResult, ImageSize, ProviderId,
};

/// One AI image backend (OpenAI, xAI or Gemini).
///
/// Implementations are cheap handles: they hold an HTTP client and an
/// [`crate::AuthMethod`], never document state. They must be `Send + Sync` so the Tokio
/// job queue can run several jobs concurrently from a shared registry.
#[async_trait]
pub trait ImageProvider: Send + Sync {
    /// Which provider this is.
    fn id(&self) -> ProviderId;

    /// Static capability matrix (what the UI may offer for this provider).
    fn capabilities(&self) -> Capabilities;

    /// Text -> image(s). Returns one [`ImageResult`] per requested variant.
    async fn generate(&self, req: GenerateRequest) -> Result<Vec<ImageResult>, Error>;

    /// Image (+ optional mask) + prompt -> image(s).
    ///
    /// When `req.mask` is `Some` but [`Capabilities::mask_edit`] is `false`, the
    /// implementation must return [`Error::Unsupported`]; the webview is responsible
    /// for mask emulation (PLAN.md section 2.2) and will never send such a request.
    async fn edit(&self, req: EditRequest) -> Result<Vec<ImageResult>, Error>;

    /// Cheapest possible authenticated call (list models) to verify the configured key.
    ///
    /// Returns `Ok(())` when the provider accepted the credentials; [`Error::Auth`] when
    /// it rejected them. Never generates an image, never costs money.
    async fn test_key(&self) -> Result<(), Error>;
}

/// Object-safe handle used by the provider registry.
pub type BoxedProvider = Box<dyn ImageProvider>;

/// Validate a [`GenerateRequest`] against a provider's capabilities before sending it.
///
/// Shared by all providers so the error messages are consistent.
pub fn validate_generate(
    provider: &ProviderId,
    caps: &Capabilities,
    req: &GenerateRequest,
) -> Result<(), Error> {
    if !caps.generate {
        return Err(Error::Unsupported {
            provider: provider.clone(),
            capability: "generate",
        });
    }
    if req.prompt.trim().is_empty() {
        return Err(Error::InvalidRequest("prompt is empty".to_owned()));
    }
    if req.n == 0 || req.n > caps.max_variants {
        return Err(Error::InvalidRequest(format!(
            "n must be between 1 and {}",
            caps.max_variants
        )));
    }
    if req.reference_images.len() > 1 && !caps.multi_ref {
        return Err(Error::Unsupported {
            provider: provider.clone(),
            capability: "multiple reference images",
        });
    }
    check_ref_count(provider, caps, req.reference_images.len())?;
    if let Some(size) = req.size {
        check_size(provider, caps, size)?;
    }
    Ok(())
}

fn check_size(provider: &ProviderId, caps: &Capabilities, size: ImageSize) -> Result<(), Error> {
    if size.width == 0 || size.height == 0 {
        return Err(Error::InvalidRequest(format!("{size} has a zero edge")));
    }
    if caps.max_px > 0 && (size.width > caps.max_px || size.height > caps.max_px) {
        return Err(Error::InvalidRequest(format!(
            "{size} exceeds the provider maximum of {} px",
            caps.max_px
        )));
    }
    if !caps.custom_sizes && !caps.sizes.is_empty() && !caps.sizes.contains(&size) {
        return Err(Error::InvalidRequest(format!(
            "{size} is not one of the sizes {provider} accepts"
        )));
    }
    Ok(())
}

fn check_ref_count(provider: &ProviderId, caps: &Capabilities, images: usize) -> Result<(), Error> {
    if caps.max_refs > 0 && images > usize::from(caps.max_refs) {
        return Err(Error::InvalidRequest(format!(
            "{images} input images exceed the {} {provider} accepts",
            caps.max_refs
        )));
    }
    Ok(())
}

/// Validate an [`EditRequest`] against a provider's capabilities before sending it.
pub fn validate_edit(
    provider: &ProviderId,
    caps: &Capabilities,
    req: &EditRequest,
) -> Result<(), Error> {
    match req.mode {
        EditMode::Mask => {
            if !caps.mask_edit {
                return Err(Error::Unsupported {
                    provider: provider.clone(),
                    capability: "mask edit",
                });
            }
            if req.mask.as_ref().is_none_or(|m| m.is_empty()) {
                return Err(Error::InvalidRequest(
                    "mask edit requires a non-empty mask".to_owned(),
                ));
            }
        }
        EditMode::Instruct => {
            if !caps.instruct_edit {
                return Err(Error::Unsupported {
                    provider: provider.clone(),
                    capability: "instruct edit",
                });
            }
        }
    }
    if req.prompt.trim().is_empty() {
        return Err(Error::InvalidRequest("prompt is empty".to_owned()));
    }
    if req.image.is_empty() {
        return Err(Error::InvalidRequest("input image is empty".to_owned()));
    }
    if !req.reference_images.is_empty() && !caps.multi_ref {
        return Err(Error::Unsupported {
            provider: provider.clone(),
            capability: "multiple reference images",
        });
    }
    check_ref_count(provider, caps, 1 + req.reference_images.len())?;
    if let Some(size) = req.size {
        check_size(provider, caps, size)?;
    }
    if req.n == 0 || req.n > caps.max_variants {
        return Err(Error::InvalidRequest(format!(
            "n must be between 1 and {}",
            caps.max_variants
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ImageBytes;

    /// Proves the trait is object safe and usable through `Box<dyn ImageProvider>`.
    struct Dummy;

    #[async_trait]
    impl ImageProvider for Dummy {
        fn id(&self) -> ProviderId {
            ProviderId::Gemini
        }

        fn capabilities(&self) -> Capabilities {
            Capabilities {
                generate: true,
                instruct_edit: true,
                max_variants: 2,
                max_px: 2048,
                ..Capabilities::default()
            }
        }

        async fn generate(&self, req: GenerateRequest) -> Result<Vec<ImageResult>, Error> {
            validate_generate(&self.id(), &self.capabilities(), &req)?;
            Ok(vec![ImageResult {
                image: ImageBytes::png(vec![0x89, b'P', b'N', b'G']),
                width: 1,
                height: 1,
                provider: self.id(),
                model: "dummy".to_owned(),
                revised_prompt: None,
                cost_usd: Some(0.0),
            }])
        }

        async fn edit(&self, req: EditRequest) -> Result<Vec<ImageResult>, Error> {
            validate_edit(&self.id(), &self.capabilities(), &req)?;
            Ok(Vec::new())
        }

        async fn test_key(&self) -> Result<(), Error> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn boxed_provider_dispatches_and_validates() {
        let provider: BoxedProvider = Box::new(Dummy);
        assert_eq!(provider.id(), ProviderId::Gemini);

        let ok = provider
            .generate(GenerateRequest {
                prompt: "a neon anvil".to_owned(),
                ..GenerateRequest::default()
            })
            .await
            .expect("generate succeeds");
        assert_eq!(ok.len(), 1);
        assert_eq!(ok[0].provider, ProviderId::Gemini);

        let err = provider
            .generate(GenerateRequest::default())
            .await
            .expect_err("empty prompt is rejected");
        assert_eq!(err.code(), "ai_invalid_request");

        let err = provider
            .generate(GenerateRequest {
                prompt: "x".to_owned(),
                size: Some(ImageSize::square(4096)),
                ..GenerateRequest::default()
            })
            .await
            .expect_err("oversize is rejected");
        assert!(err.to_string().contains("2048"));

        let masked =
            EditRequest::masked("fill", ImageBytes::png(vec![1]), ImageBytes::png(vec![1]));
        let err = provider.edit(masked).await.expect_err("no native mask");
        assert!(matches!(
            err,
            Error::Unsupported {
                capability: "mask edit",
                ..
            }
        ));

        let instruct = EditRequest::instruct("fill", ImageBytes::png(vec![1]));
        provider
            .edit(instruct)
            .await
            .expect("instruct is supported");
    }
}
